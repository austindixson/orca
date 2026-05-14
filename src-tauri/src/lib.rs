use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, State, Window};
use tokio::io::{AsyncRead, AsyncReadExt};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};

mod git_worktree;
mod obsidian_vaults;
mod llm_env;
mod pi_oauth;
mod pi_oauth_login;
mod orca_data;
mod orca_index;
mod pty;
mod skinnytools;
mod workspace_paths;
mod workspace_grep;
mod workspace_watch;
mod central_brain;
mod central_brain_watch;
mod bedrock_invoke;
mod orca_bridge;
mod orca_tray;
#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod app_menu;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileEntry {
    name: String,
    path: String,
    is_directory: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileContent {
    content: String,
    path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BinaryFileContent {
    name: String,
    path: String,
    mime: String,
    size: usize,
    data_base64: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorkspaceInfo {
    path: String,
    name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResourceUsage {
    pid: u32,
    rss_kb: u64,
    rss_mb: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitFileChange {
    path: String,
    xy: String,
    staged: bool,
    unstaged: bool,
    untracked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitChangelogSnapshot {
    workspace_path: String,
    is_repo: bool,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    staged_count: u32,
    unstaged_count: u32,
    untracked_count: u32,
    changed_files: Vec<GitFileChange>,
    recent_commits: Vec<String>,
    summary: String,
    next_steps: Vec<String>,
    generated_at_ms: u64,
}

pub struct AppState {
    /// Workspace root per webview window (label); each window can open a different folder.
    workspace_by_window: Mutex<HashMap<String, PathBuf>>,
    pty_sessions: Mutex<HashMap<String, pty::PtySession>>,
    /// Maps PTY session id → webview window label (for cleanup when a window closes).
    pty_window: Mutex<HashMap<String, String>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            workspace_by_window: Mutex::new(HashMap::new()),
            pty_sessions: Mutex::new(HashMap::new()),
            pty_window: Mutex::new(HashMap::new()),
        }
    }
}

fn kill_ptys_for_window(state: &AppState, window_label: &str) {
    let ids: Vec<String> = {
        let map = state.pty_window.lock().unwrap();
        map.iter()
            .filter(|(_, w)| *w == window_label)
            .map(|(id, _)| id.clone())
            .collect()
    };
    for id in &ids {
        state.pty_window.lock().unwrap().remove(id);
    }
    let mut sessions = state.pty_sessions.lock().unwrap();
    for id in ids {
        if let Some(s) = sessions.remove(&id) {
            s.close();
        }
    }
}

fn kill_all_ptys(state: &AppState) {
    state.pty_window.lock().unwrap().clear();
    state.workspace_by_window.lock().unwrap().clear();
    let mut sessions = state.pty_sessions.lock().unwrap();
    for (_, s) in sessions.drain() {
        s.close();
    }
}

pub(crate) fn workspace_path_for_window(state: &AppState, window_label: &str) -> PathBuf {
    let map = state.workspace_by_window.lock().unwrap();
    map.get(window_label)
        .cloned()
        .unwrap_or_else(|| PathBuf::from("."))
}

#[tauri::command]
async fn open_folder_dialog(app: AppHandle) -> Result<Option<WorkspaceInfo>, String> {
    use tauri_plugin_dialog::DialogExt;

    // Use the async callback API rather than `blocking_pick_folder()`. On macOS
    // the native folder picker must run on the main thread; blocking a Tokio
    // worker while waiting for it deadlocks and the dialog never appears
    // (which looks like "clicking New folder does nothing").
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    let folder = rx
        .await
        .map_err(|e| format!("Folder dialog was cancelled unexpectedly: {e}"))?;

    match folder {
        Some(file_path) => {
            let path_str = file_path.to_string();
            let name = if let Some(p) = file_path.as_path() {
                p.file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| path_str.clone())
            } else {
                path_str.clone()
            };
            
            Ok(Some(WorkspaceInfo {
                path: path_str,
                name,
            }))
        }
        None => Ok(None),
    }
}

#[derive(serde::Deserialize)]
pub struct FileDialogFilter {
    name: String,
    extensions: Vec<String>,
}

/// Native save dialog (non-blocking callback + oneshot), mirroring `open_folder_dialog`.
#[tauri::command]
async fn save_file_dialog(
    app: AppHandle,
    default_path: Option<String>,
    filters: Option<Vec<FileDialogFilter>>,
) -> Result<Option<String>, String> {
    use std::path::PathBuf;
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();

    let mut builder = app.dialog().file();
    if let Some(ref p) = default_path {
        let pb = PathBuf::from(p);
        if let Some(parent) = pb.parent() {
            if parent.as_os_str().len() > 0 {
                builder = builder.set_directory(parent);
            }
        }
        if let Some(name) = pb.file_name().and_then(|n| n.to_str()) {
            builder = builder.set_file_name(name);
        }
    }
    if let Some(fs) = filters {
        for f in fs {
            let ext: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&f.name, &ext);
        }
    }
    builder.save_file(move |file| {
        let out = file.map(|fp| fp.to_string());
        let _ = tx.send(out);
    });

    let folder = rx
        .await
        .map_err(|e| format!("Save dialog closed unexpectedly: {e}"))?;
    Ok(folder)
}

/// Pick a single file to open (UTF-8 path string for the webview).
#[tauri::command]
async fn open_file_dialog(
    app: AppHandle,
    filters: Option<Vec<FileDialogFilter>>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    let mut builder = app.dialog().file();
    if let Some(fs) = filters {
        for f in fs {
            let ext: Vec<&str> = f.extensions.iter().map(|s| s.as_str()).collect();
            builder = builder.add_filter(&f.name, &ext);
        }
    }
    builder.pick_file(move |file| {
        let out = file.map(|fp| fp.to_string());
        let _ = tx.send(out);
    });

    rx.await
        .map_err(|e| format!("Open file dialog closed unexpectedly: {e}"))
}

/// Pick a folder without changing the workspace (e.g. central Obsidian vault path).
#[tauri::command]
async fn pick_central_brain_folder_dialog(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |folder| {
        let _ = tx.send(folder);
    });

    let folder = rx
        .await
        .map_err(|e| format!("Folder dialog was cancelled unexpectedly: {e}"))?;

    match folder {
        Some(file_path) => Ok(Some(file_path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn start_central_brain_watch(
    app: AppHandle,
    window_label: String,
    vault_root: String,
    project_id: String,
) {
    central_brain_watch::spawn_central_brain_watch(app, window_label, vault_root, project_id);
}

#[tauri::command]
async fn set_workspace(window: Window, path: String, state: State<'_, AppState>) -> Result<WorkspaceInfo, String> {
    let label = window.label().to_string();
    log::info!("Setting workspace for window {} to: {}", label, path);

    let path_buf = PathBuf::from(&path);

    if !path_buf.exists() {
        log::error!("Path does not exist: {}", path);
        return Err("Path does not exist".to_string());
    }

    if !path_buf.is_dir() {
        log::error!("Path is not a directory: {}", path);
        return Err("Path is not a directory".to_string());
    }

    let name = path_buf
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    state
        .workspace_by_window
        .lock()
        .unwrap()
        .insert(label.clone(), path_buf.clone());

    log::info!("Workspace set successfully: {:?}", path_buf);

    workspace_watch::spawn_workspace_fs_watch(window.app_handle().clone(), label, path_buf);

    Ok(WorkspaceInfo { path, name })
}

/// User home directory (for discovering `~/.cursor/skills`, etc.).
#[tauri::command]
fn get_home_dir() -> Option<String> {
    dirs::home_dir().map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_workspace(window: Window, state: State<'_, AppState>) -> Result<Option<WorkspaceInfo>, String> {
    let label = window.label().to_string();
    let workspace = state.workspace_by_window.lock().unwrap();

    match workspace.get(&label) {
        Some(path) => {
            let path_str = path.to_string_lossy().to_string();
            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path_str.clone());

            Ok(Some(WorkspaceInfo {
                path: path_str,
                name,
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
async fn read_directory(window: Window, path: String, state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&state, &label);
    
    let full_path = if path == "." || path.trim().is_empty() {
        fs::canonicalize(&base_path).map_err(|e| format!("workspace: {}", e))?
    } else {
        workspace_paths::resolve_under_workspace(&base_path, &path)?
    };
    
    let entries = fs::read_dir(&full_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;
    
    let mut files: Vec<FileEntry> = Vec::new();
    
    for entry in entries {
        if let Ok(entry) = entry {
            let file_name = entry.file_name().to_string_lossy().to_string();
            
            // Skip hidden files/folders
            if file_name.starts_with('.') {
                continue;
            }
            
            let file_path = if path == "." || path.trim().is_empty() {
                file_name.clone()
            } else {
                format!("{}/{}", path.trim_end_matches(['/', '\\']), file_name)
            };
            
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            
            files.push(FileEntry {
                name: file_name,
                path: file_path,
                is_directory: is_dir,
            });
        }
    }
    
    // Sort: directories first, then alphabetically
    files.sort_by(|a, b| {
        match (a.is_directory, b.is_directory) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });
    
    Ok(files)
}

#[tauri::command]
async fn read_file(window: Window, path: String, state: State<'_, AppState>) -> Result<FileContent, String> {
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&state, &label);
    
    let full_path = workspace_paths::resolve_under_workspace(&base_path, &path)?;

    let meta = fs::metadata(&full_path).map_err(|e| format!("Failed to stat file: {}", e))?;
    if !meta.is_file() {
        return Err("Path is not a file".to_string());
    }
    if meta.len() > workspace_paths::MAX_READ_BYTES {
        return Err(format!(
            "File too large ({} bytes); max {} bytes for text read",
            meta.len(),
            workspace_paths::MAX_READ_BYTES
        ));
    }

    let bytes = fs::read(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
    if workspace_paths::sniff_binary_utf8(&bytes) {
        return Err(
            "File appears to be binary (NUL byte in first 8KiB); use a dedicated binary workflow"
                .to_string(),
        );
    }
    let content = String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8".to_string())?;

    let rel = workspace_paths::normalize_relative_workspace_path(&path).unwrap_or(path.clone());
    Ok(FileContent { content, path: rel })
}

fn guess_mime_from_path(path: &str) -> String {
    let lower = path.to_lowercase();
    if lower.ends_with(".png") { return "image/png".to_string(); }
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") { return "image/jpeg".to_string(); }
    if lower.ends_with(".webp") { return "image/webp".to_string(); }
    if lower.ends_with(".gif") { return "image/gif".to_string(); }
    if lower.ends_with(".txt") || lower.ends_with(".md") || lower.ends_with(".log") {
        return "text/plain".to_string();
    }
    if lower.ends_with(".json") { return "application/json".to_string(); }
    if lower.ends_with(".yml") || lower.ends_with(".yaml") { return "application/yaml".to_string(); }
    if lower.ends_with(".toml") { return "application/toml".to_string(); }
    "application/octet-stream".to_string()
}

fn mime_to_extension(mime: &str) -> &'static str {
    let m = mime.to_ascii_lowercase();
    if m.contains("png") { return "png"; }
    if m.contains("jpeg") || m.contains("jpg") { return "jpg"; }
    if m.contains("webp") { return "webp"; }
    if m.contains("gif") { return "gif"; }
    "bin"
}

fn sanitize_attachment_stem(name: &str) -> String {
    let base = name.trim();
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('-');
        }
    }
    let compact = out.trim_matches('-');
    if compact.is_empty() {
        "pasted-image".to_string()
    } else {
        compact.chars().take(48).collect::<String>()
    }
}

#[tauri::command]
async fn save_clipboard_image_temp(
    data_base64: String,
    mime: String,
    suggested_name: Option<String>,
) -> Result<String, String> {
    let bytes = BASE64_STANDARD
        .decode(data_base64.as_bytes())
        .map_err(|e| format!("Invalid base64 image payload: {}", e))?;
    if bytes.is_empty() {
        return Err("Empty clipboard image payload".to_string());
    }

    let ext = mime_to_extension(&mime);
    let stem = sanitize_attachment_stem(suggested_name.as_deref().unwrap_or("pasted-image"));
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Clock error: {}", e))?
        .as_millis();

    let dir = std::env::temp_dir().join("orca-pasted-images");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let full = dir.join(format!("{}-{}.{}", stem, ts, ext));
    fs::write(&full, bytes).map_err(|e| format!("Failed to write temp image: {}", e))?;
    Ok(full.to_string_lossy().to_string())
}

#[tauri::command]
async fn read_file_binary(path: String) -> Result<BinaryFileContent, String> {
    let full_path = PathBuf::from(&path);
    if !full_path.exists() {
        return Err("Path does not exist".to_string());
    }
    if full_path.is_dir() {
        return Err("Path is a directory".to_string());
    }
    let bytes = fs::read(&full_path).map_err(|e| format!("Failed to read file: {}", e))?;
    let name = full_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let mime = guess_mime_from_path(&path);
    Ok(BinaryFileContent {
        name,
        path,
        mime,
        size: bytes.len(),
        data_base64: BASE64_STANDARD.encode(bytes),
    })
}

#[tauri::command]
async fn write_file(window: Window, path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&state, &label);

    if content.len() as u64 > workspace_paths::MAX_WRITE_BYTES {
        return Err(format!(
            "Content too large ({} bytes); max {} bytes",
            content.len(),
            workspace_paths::MAX_WRITE_BYTES
        ));
    }

    let full_path = workspace_paths::resolve_under_workspace(&base_path, &path)?;
    
    // Ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    
    fs::write(&full_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn create_directory(window: Window, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&state, &label);
    
    let full_path = workspace_paths::resolve_under_workspace(&base_path, &path)?;
    
    fs::create_dir_all(&full_path)
        .map_err(|e| format!("Failed to create directory: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn delete_path(window: Window, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&state, &label);
    
    let full_path = workspace_paths::resolve_under_workspace(&base_path, &path)?;
    
    if full_path.is_dir() {
        fs::remove_dir_all(&full_path)
            .map_err(|e| format!("Failed to delete directory: {}", e))?;
    } else {
        fs::remove_file(&full_path)
            .map_err(|e| format!("Failed to delete file: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
async fn rename_path(
    window: Window,
    old_path: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&state, &label);
    
    let old_full_path = workspace_paths::resolve_under_workspace(&base_path, &old_path)?;
    let new_full_path = workspace_paths::resolve_under_workspace(&base_path, &new_path)?;
    
    fs::rename(&old_full_path, &new_full_path)
        .map_err(|e| format!("Failed to rename: {}", e))?;
    
    Ok(())
}

// PTY Terminal Commands
#[tauri::command]
async fn create_pty_session(
    window: Window,
    id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let label = window.label().to_string();
    // Fast duplicate check only — do NOT hold this mutex while creating the PTY. `PtySession::new`
    // is slow (openpty + shell spawn + reader threads). Holding the global map lock there serializes
    // every tile's connect and can exceed the webview's invoke timeout when many terminals mount at
    // once (e.g. orchestrator spamming `canvas_create_tile` for "Dev Server").
    {
        let sessions = state.pty_sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            log::info!("PTY session {} already exists, skipping duplicate creation", id);
            return Ok(());
        }
    }

    let cwd = {
        let workspace = state.workspace_by_window.lock().unwrap();
        log::info!("Current workspace state for {}: {:?}", label, workspace.get(&label));
        workspace.get(&label).cloned().unwrap_or_else(|| {
            log::info!("No workspace set, using home directory");
            dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
        })
    };

    log::info!("Creating PTY session {} with cwd: {:?}", id, cwd);

    // `PtySession::new` is synchronous and heavy (openpty, shell spawn, reader threads). Running it
    // directly on the async runtime blocks Tokio worker threads and can delay every other Tauri IPC
    // — under load the webview's `create_pty_session` invoke may not return before the client
    // timeout. Run on the blocking pool like other shell/PTY work in this crate.
    let id_for_pty = id.clone();
    let cwd_for_pty = cwd;
    let app_for_pty = app.clone();
    let session = match tauri::async_runtime::spawn_blocking(move || {
        pty::PtySession::new(&id_for_pty, cwd_for_pty, app_for_pty).map_err(|e| e.to_string())
    })
    .await
    {
        Ok(Ok(session)) => session,
        Ok(Err(msg)) => {
            log::error!("Failed to create PTY: {}", msg);
            return Err(format!("Failed to create PTY: {}", msg));
        }
        Err(e) => {
            return Err(format!("Failed to join PTY creation task: {}", e));
        }
    };

    log::info!("PTY session created successfully");

    {
        let mut sessions = state.pty_sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            // Lost a race (e.g. React Strict Mode or two tiles with same id); drop our duplicate.
            log::info!("PTY session {} already exists (race), closing duplicate handle", id);
            session.close();
            return Ok(());
        }
        sessions.insert(id.clone(), session);
    }
    state
        .pty_window
        .lock()
        .unwrap()
        .insert(id, label);

    Ok(())
}

#[tauri::command]
async fn write_to_pty(id: String, data: String, state: State<'_, AppState>) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().unwrap();
    
    if let Some(session) = sessions.get(&id) {
        session.write(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
    } else {
        return Err("PTY session not found".to_string());
    }
    
    Ok(())
}

#[tauri::command]
async fn resize_pty(id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> Result<(), String> {
    let sessions = state.pty_sessions.lock().unwrap();
    
    if let Some(session) = sessions.get(&id) {
        session.resize(cols, rows)
            .map_err(|e| format!("Failed to resize PTY: {}", e))?;
    } else {
        return Err("PTY session not found".to_string());
    }
    
    Ok(())
}

#[tauri::command]
async fn close_pty_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.pty_window.lock().unwrap().remove(&id);
    let mut sessions = state.pty_sessions.lock().unwrap();

    if let Some(session) = sessions.remove(&id) {
        session.close();
    }

    Ok(())
}

/// Quit the entire application after killing shells / PTYs (File → Quit, Cmd+Q when wired to this).
#[tauri::command]
fn exit_app(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    kill_all_ptys(&state);
    app.exit(0);
    Ok(())
}

/// Hermes / OpenClaw–compatible: `OPENAI_API_KEY`, `GLM_API_KEY`, etc., plus `~/.hermes/.env` and `~/.openclaw/.env`.
#[tauri::command]
fn resolve_llm_api_key(provider: String) -> Option<String> {
    llm_env::resolve_provider_api_key(&provider)
}

#[tauri::command]
fn resolve_llm_base_url(provider: String) -> Option<String> {
    llm_env::resolve_provider_base_url(&provider)
}

#[tauri::command]
fn resolve_hermes_api_server_key() -> Option<String> {
    llm_env::resolve_hermes_api_server_key()
}

#[tauri::command]
fn llm_shell_credential_flags() -> std::collections::HashMap<String, bool> {
    let mut m = std::collections::HashMap::new();
    for p in [
        "openai",
        "openai-codex",
        "anthropic",
        "google",
        "openrouter",
        "zai",
        "github-copilot",
        "mistral",
        "azure-openai-responses",
        "google-vertex",
        "bedrock",
    ] {
        m.insert(
            p.to_string(),
            llm_env::resolve_provider_api_key(p).is_some(),
        );
    }
    m
}

/// Pi Mono `~/.pi/agent/auth.json` registry keys (see `packages/ai/src/utils/oauth/index.ts`).
#[tauri::command]
fn pi_oauth_registry_status() -> Vec<pi_oauth::PiRegistryKeyStatus> {
    pi_oauth::pi_oauth_registry_status()
}

#[tauri::command]
async fn pi_oauth_login_anthropic() -> Result<(), String> {
    tokio::task::spawn_blocking(pi_oauth_login::login_anthropic_oauth)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pi_oauth_login_openai_codex() -> Result<(), String> {
    tokio::task::spawn_blocking(pi_oauth_login::login_openai_codex_oauth)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn pi_oauth_login_google_gemini_cli() -> Result<(), String> {
    tokio::task::spawn_blocking(pi_oauth_login::login_google_gemini_cli_oauth)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_resource_usage() -> Result<ResourceUsage, String> {
    let pid = std::process::id();
    let rss_kb = query_rss_kb(pid).await?;
    let rss_mb = rss_kb as f64 / 1024.0;

    Ok(ResourceUsage {
        pid,
        rss_kb,
        rss_mb,
    })
}

#[tauri::command]
async fn get_git_changelog_snapshot(
    window: Window,
    state: State<'_, AppState>,
) -> Result<GitChangelogSnapshot, String> {
    let label = window.label().to_string();
    let workspace_path = {
        let guard = state.workspace_by_window.lock().unwrap();
        guard
            .get(&label)
            .map(|p| p.to_string_lossy().to_string())
    };

    let generated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let Some(workspace_path) = workspace_path else {
        return Ok(GitChangelogSnapshot {
            workspace_path: ".".to_string(),
            is_repo: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            changed_files: vec![],
            recent_commits: vec![],
            summary: "Workspace is not set yet. Open a folder to enable changelog automation.".to_string(),
            next_steps: vec!["Use Open Folder first.".to_string()],
            generated_at_ms,
        });
    };

    let is_repo = run_git(&workspace_path, &["rev-parse", "--is-inside-work-tree"]).await
        .map(|s| s.trim() == "true")
        .unwrap_or(false);

    if !is_repo {
        return Ok(GitChangelogSnapshot {
            workspace_path,
            is_repo: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            staged_count: 0,
            unstaged_count: 0,
            untracked_count: 0,
            changed_files: vec![],
            recent_commits: vec![],
            summary: "No git repository found in current workspace.".to_string(),
            next_steps: vec!["Initialize one with: git init".to_string()],
            generated_at_ms,
        });
    }

    let status = run_git(&workspace_path, &["status", "--porcelain=v1", "--branch"]).await?;
    let mut branch: Option<String> = None;
    let mut upstream: Option<String> = None;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut staged_count = 0u32;
    let mut unstaged_count = 0u32;
    let mut untracked_count = 0u32;
    let mut changed_files: Vec<GitFileChange> = Vec::new();

    for (idx, raw_line) in status.lines().enumerate() {
        if idx == 0 && raw_line.starts_with("## ") {
            let header = raw_line.trim_start_matches("## ").trim();
            let branch_part = header
                .split(' ')
                .next()
                .unwrap_or(header);
            if let Some((b, up)) = branch_part.split_once("...") {
                if !b.is_empty() {
                    branch = Some(b.to_string());
                }
                if !up.is_empty() {
                    upstream = Some(up.to_string());
                }
            } else if !branch_part.is_empty() {
                branch = Some(branch_part.to_string());
            }
            if let Some(start) = header.find('[') {
                if let Some(end) = header[start + 1..].find(']') {
                    let inner = &header[start + 1..start + 1 + end];
                    for part in inner.split(',') {
                        let p = part.trim();
                        if let Some(n) = p.strip_prefix("ahead ") {
                            ahead = n.trim().parse::<u32>().unwrap_or(0);
                        } else if let Some(n) = p.strip_prefix("behind ") {
                            behind = n.trim().parse::<u32>().unwrap_or(0);
                        }
                    }
                }
            }
            continue;
        }

        if raw_line.trim().is_empty() || raw_line.len() < 3 {
            continue;
        }

        let x = raw_line.chars().nth(0).unwrap_or(' ');
        let y = raw_line.chars().nth(1).unwrap_or(' ');
        let path = raw_line[3..].trim().to_string();
        let untracked = x == '?' && y == '?';
        let staged = x != ' ' && x != '?';
        let unstaged = y != ' ' && y != '?';

        if staged {
            staged_count += 1;
        }
        if unstaged {
            unstaged_count += 1;
        }
        if untracked {
            untracked_count += 1;
        }

        changed_files.push(GitFileChange {
            path,
            xy: format!("{x}{y}"),
            staged,
            unstaged,
            untracked,
        });
    }

    let recent_commits_raw = run_git(&workspace_path, &["log", "--oneline", "-n", "8"])
        .await
        .unwrap_or_default();
    let recent_commits = recent_commits_raw
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();

    let total_changed = changed_files.len();
    let branch_label = branch.clone().unwrap_or_else(|| "detached".to_string());
    let mut summary = format!(
        "{branch_label} · {total_changed} changed file(s) ({staged_count} staged, {unstaged_count} unstaged, {untracked_count} untracked)"
    );
    if ahead > 0 || behind > 0 {
        summary.push_str(&format!(" · ahead {ahead}, behind {behind}"));
    }

    let mut next_steps = vec![
        "git status".to_string(),
        "git add -A".to_string(),
        "git commit -m \"chore: update changelog\"".to_string(),
    ];
    if behind > 0 {
        next_steps.push("git pull --rebase".to_string());
    }
    next_steps.push("git push".to_string());
    next_steps.push("gh pr create --fill".to_string());

    Ok(GitChangelogSnapshot {
        workspace_path,
        is_repo: true,
        branch,
        upstream,
        ahead,
        behind,
        staged_count,
        unstaged_count,
        untracked_count,
        changed_files: changed_files.into_iter().take(120).collect(),
        recent_commits,
        summary,
        next_steps,
        generated_at_ms,
    })
}

async fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let cwd_owned = cwd.to_string();
    let args_owned = args.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    let output = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("git");
        cmd.arg("-C").arg(&cwd_owned);
        for a in &args_owned {
            cmd.arg(a);
        }
        cmd.output()
    })
    .await
    .map_err(|e| format!("Failed to join git task: {e}"))?
    .map_err(|e| format!("Failed to run git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            return Err("Git command failed".to_string());
        }
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(unix)]
async fn query_rss_kb(pid: u32) -> Result<u64, String> {
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("ps")
            .args(["-o", "rss=", "-p", &pid.to_string()])
            .output()
    })
    .await
    .map_err(|e| format!("Failed to join ps query task: {e}"))?
    .map_err(|e| format!("Failed to run ps: {e}"))?;

    if !output.status.success() {
        return Err("Failed to query process memory usage".to_string());
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to decode process usage output: {e}"))?;
    stdout
        .trim()
        .parse::<u64>()
        .map_err(|e| format!("Failed to parse RSS output: {e}"))
}

#[cfg(not(unix))]
async fn query_rss_kb(_pid: u32) -> Result<u64, String> {
    Err("Process memory monitor is currently supported on Unix platforms only".to_string())
}

/// Compress tool-result strings before they enter the LLM context (Rust port of skinnytools; no Python).
#[tauri::command]
async fn skinnytools_filter(input: String) -> Result<String, String> {
    if std::env::var("AGENT_CANVAS_DISABLE_SKINNYTOOLS")
        .ok()
        .as_deref()
        == Some("1")
    {
        return Ok(input);
    }

    tauri::async_runtime::spawn_blocking(move || Ok(skinnytools::process(&input)))
        .await
        .map_err(|e| format!("skinnytools join error: {e}"))?
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GhCliResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Result of `agent-browser ...` — matches the desktop client's `AgentBrowserResult` shape.
#[derive(Debug, Serialize, Deserialize)]
pub struct AgentBrowserRunResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

/// Result of `hermes --version` — used to guide users who enabled Hermes UI without a local CLI.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesCliProbeResult {
    pub installed: bool,
    pub version_line: Option<String>,
    pub stderr_or_error: Option<String>,
}

/// Run `hermes --version` (no shell). Does not require a workspace folder.
#[tauri::command]
async fn probe_hermes_cli() -> Result<HermesCliProbeResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut cmd = Command::new("hermes");
        cmd.arg("--version");
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let output = match cmd.output() {
            Ok(o) => o,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    return Ok(HermesCliProbeResult {
                        installed: false,
                        version_line: None,
                        stderr_or_error: Some(
                            "The `hermes` command was not found on PATH. Install the Hermes CLI from NousResearch (see https://github.com/NousResearch/hermes-agent) and ensure `hermes` is available in a terminal.".to_string(),
                        ),
                    });
                }
                return Err(format!("Could not run `hermes`: {e}"));
            }
        };
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let code = output.status.code().unwrap_or(-1);
        if !output.status.success() {
            return Ok(HermesCliProbeResult {
                installed: false,
                version_line: if stdout.is_empty() {
                    None
                } else {
                    Some(stdout.clone())
                },
                stderr_or_error: Some(if stderr.is_empty() {
                    format!("`hermes --version` exited with code {code}")
                } else {
                    stderr
                }),
            });
        }
        let version_line = stdout
            .lines()
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(std::string::ToString::to_string)
            .or_else(|| if stdout.is_empty() { None } else { Some(stdout) });
        Ok(HermesCliProbeResult {
            installed: true,
            version_line,
            stderr_or_error: if stderr.is_empty() {
                None
            } else {
                Some(stderr)
            },
        })
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
}

/// Run `gh` with the given argv (no shell). Uses the current workspace as cwd.
#[tauri::command]
async fn run_gh_cli(
    window: Window,
    args: Vec<String>,
    state: State<'_, AppState>,
) -> Result<GhCliResult, String> {
    if args.is_empty() {
        return Err("Pass at least one argument (e.g. auth status).".into());
    }
    if args.len() > 200 {
        return Err("Too many gh arguments.".into());
    }
    for a in &args {
        if a.len() > 12_000 {
            return Err("Argument too long.".into());
        }
    }

    let label = window.label().to_string();
    let cwd = {
        let workspace = state.workspace_by_window.lock().unwrap();
        workspace
            .get(&label)
            .cloned()
            .ok_or_else(|| {
                "No workspace folder open — open a project in the sidebar first.".to_string()
            })?
    };

    let args_clone = args.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("gh");
        for a in args_clone {
            cmd.arg(a);
        }
        cmd.current_dir(&cwd);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let output = cmd.output().map_err(|e| {
            format!(
                "Could not run `gh`. Install GitHub CLI (https://cli.github.com/) and ensure it is on PATH: {e}"
            )
        })?;
        Ok(GhCliResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
}

/// Run `agent-browser` with the given argv (no shell). Uses the current workspace as cwd.
/// Returns structured stdout/stderr/exit code so the webview can surface CLI failures without throwing.
#[tauri::command]
async fn run_agent_browser(
    window: Window,
    args: Vec<String>,
    state: State<'_, AppState>,
) -> Result<AgentBrowserRunResult, String> {
    if args.is_empty() {
        return Err("Pass at least one argument (e.g. open, snapshot, --session).".into());
    }
    if args.len() > 200 {
        return Err("Too many agent-browser arguments.".into());
    }
    for a in &args {
        if a.len() > 12_000 {
            return Err("Argument too long.".into());
        }
    }

    let label = window.label().to_string();
    let cwd = {
        let workspace = state.workspace_by_window.lock().unwrap();
        workspace
            .get(&label)
            .cloned()
            .ok_or_else(|| {
                "No workspace folder open — open a project in the sidebar first.".to_string()
            })?
    };

    let args_clone = args.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("agent-browser");
        for a in args_clone {
            cmd.arg(a);
        }
        cmd.current_dir(&cwd);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let output = match cmd.output() {
            Ok(o) => o,
            Err(e) => {
                let stderr = if e.kind() == std::io::ErrorKind::NotFound {
                    "agent-browser CLI not found on PATH. Install: npm install -g agent-browser && agent-browser install"
                        .to_string()
                } else {
                    format!("Could not run agent-browser: {e}")
                };
                return Ok(AgentBrowserRunResult {
                    ok: false,
                    stdout: String::new(),
                    stderr,
                    code: -1,
                });
            }
        };
        let code = output.status.code().unwrap_or(-1);
        Ok(AgentBrowserRunResult {
            ok: code == 0,
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            code,
        })
    })
    .await
    .map_err(|e| format!("Join error: {e}"))?
}

#[derive(Serialize)]
pub struct WorkspaceShellResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

const WORKSPACE_SHELL_MAX_CAPTURE_BYTES: usize = 512 * 1024;

async fn read_limited_stream<R: AsyncRead + Unpin>(
    mut reader: R,
    max_bytes: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut out = Vec::new();
    let mut tmp = [0u8; 8192];
    let mut truncated = false;
    loop {
        let n = reader
            .read(&mut tmp)
            .await
            .map_err(|e| format!("stream read failed: {e}"))?;
        if n == 0 {
            break;
        }
        if out.len() < max_bytes {
            let remain = max_bytes - out.len();
            let take = remain.min(n);
            out.extend_from_slice(&tmp[..take]);
            if take < n {
                truncated = true;
            }
        } else {
            truncated = true;
        }
    }
    Ok((out, truncated))
}

fn kill_workspace_shell_process_tree(pid: u32) {
    let pid_s = pid.to_string();
    #[cfg(unix)]
    {
        // Best-effort: children first, then parent shell.
        let mut pkill = Command::new("/usr/bin/pkill");
        if pkill.args(["-TERM", "-P", &pid_s]).status().is_err() {
            let _ = Command::new("pkill").args(["-TERM", "-P", &pid_s]).status();
        }
        let mut pkill_kill = Command::new("/usr/bin/pkill");
        if pkill_kill.args(["-KILL", "-P", &pid_s]).status().is_err() {
            let _ = Command::new("pkill").args(["-KILL", "-P", &pid_s]).status();
        }
        let _ = Command::new("/bin/kill").args(["-TERM", &pid_s]).status();
        let _ = Command::new("/bin/kill").args(["-KILL", &pid_s]).status();
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid_s])
            .status();
    }
}

/// One-shot shell via `sh -c` / `cmd /C` (no PTY). Use for bounded non-interactive commands; dev
/// servers / watch mode should use a terminal tile instead.
#[tauri::command]
async fn run_workspace_shell_command(
    window: Window,
    command: String,
    timeout_ms: Option<u64>,
    cwd_relative: Option<String>,
    state: State<'_, AppState>,
) -> Result<WorkspaceShellResult, String> {
    let shell_cmd = command.trim();
    if shell_cmd.is_empty() {
        return Err("command is empty".into());
    }
    if shell_cmd.len() > 120_000 {
        return Err("command exceeds maximum length".into());
    }
    if shell_cmd.contains('\0') {
        return Err("command contains null bytes".into());
    }

    let label = window.label().to_string();
    let base_path = {
        let workspace = state.workspace_by_window.lock().unwrap();
        workspace.get(&label).cloned().ok_or_else(|| {
            "No workspace folder open — open a project in the sidebar first.".to_string()
        })?
    };

    let cwd = match cwd_relative
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        None => base_path.clone(),
        Some(rel) => {
            let p = workspace_paths::resolve_under_workspace(&base_path, rel)?;
            if !p.is_dir() {
                return Err(format!(
                    "cwd_relative must be an existing directory under the workspace: {}",
                    rel
                ));
            }
            p
        }
    };

    let timeout = timeout_ms.unwrap_or(120_000).clamp(1_000, 600_000);

    #[cfg(unix)]
    let mut child = {
        let mut c = tokio::process::Command::new("/bin/sh");
        c.arg("-c").arg(shell_cmd);
        c.current_dir(&cwd);
        c.stdout(Stdio::piped());
        c.stderr(Stdio::piped());
        c.spawn()
            .map_err(|e| format!("failed to spawn /bin/sh: {e}"))?
    };

    #[cfg(windows)]
    let mut child = {
        let mut c = tokio::process::Command::new("cmd.exe");
        c.arg("/C").arg(shell_cmd);
        c.current_dir(&cwd);
        c.stdout(Stdio::piped());
        c.stderr(Stdio::piped());
        c.spawn()
            .map_err(|e| format!("failed to spawn cmd.exe: {e}"))?
    };

    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to capture stdout pipe".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to capture stderr pipe".to_string())?;
    let stdout_task = tauri::async_runtime::spawn(async move {
        read_limited_stream(stdout, WORKSPACE_SHELL_MAX_CAPTURE_BYTES).await
    });
    let stderr_task = tauri::async_runtime::spawn(async move {
        read_limited_stream(stderr, WORKSPACE_SHELL_MAX_CAPTURE_BYTES).await
    });

    let wait_res = tokio::time::timeout(
        std::time::Duration::from_millis(timeout),
        child.wait(),
    )
    .await;

    match wait_res {
        Ok(Ok(status)) => {
            let (stdout_bytes, stdout_truncated) = stdout_task
                .await
                .map_err(|e| format!("stdout reader task failed: {e}"))??;
            let (stderr_bytes, stderr_truncated) = stderr_task
                .await
                .map_err(|e| format!("stderr reader task failed: {e}"))??;
            Ok(WorkspaceShellResult {
                exit_code: status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&stdout_bytes).to_string(),
                stderr: String::from_utf8_lossy(&stderr_bytes).to_string(),
                timed_out: false,
                stdout_truncated,
                stderr_truncated,
            })
        }
        Ok(Err(e)) => Err(format!("subprocess wait failed: {e}")),
        Err(_) => {
            let _ = child.kill().await;
            if let Some(pid) = pid {
                kill_workspace_shell_process_tree(pid);
            }
            stdout_task.abort();
            stderr_task.abort();
            Ok(WorkspaceShellResult {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Orca: command timed out after {timeout}ms"),
                timed_out: true,
                stdout_truncated: false,
                stderr_truncated: false,
            })
        }
    }
}

#[cfg(test)]
mod workspace_shell_tests {
    use super::kill_workspace_shell_process_tree;
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    use std::thread;
    use std::time::Duration;

    #[cfg(unix)]
    fn process_exists(pid: u32) -> bool {
        Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    #[test]
    #[cfg(unix)]
    fn timeout_cleanup_kills_spawned_child_processes() {
        let mut parent = Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 60 & child=$!; echo $child; wait")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("failed to spawn parent shell process");

        let parent_pid = parent.id();
        assert!(parent_pid > 0, "parent pid must be set");

        let stdout = parent
            .stdout
            .take()
            .expect("expected parent shell stdout pipe");
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let bytes = reader
            .read_line(&mut line)
            .expect("failed to read child pid line");
        assert!(bytes > 0, "expected child pid output from parent shell");

        let child_pid: u32 = line
            .trim()
            .parse()
            .expect("child pid output should parse as u32");
        assert!(process_exists(child_pid), "child process should be alive before cleanup");

        kill_workspace_shell_process_tree(parent_pid);

        let mut child_stopped = false;
        for _ in 0..40 {
            if !process_exists(child_pid) {
                child_stopped = true;
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }

        let mut parent_stopped = false;
        for _ in 0..40 {
            if parent
                .try_wait()
                .expect("failed waiting on parent process")
                .is_some()
            {
                parent_stopped = true;
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }

        if !parent_stopped {
            let _ = parent.kill();
            let _ = parent.wait();
        }

        assert!(child_stopped, "process-tree cleanup should terminate spawned child process");
        assert!(parent_stopped, "process-tree cleanup should terminate parent shell process");
    }
}

/// Open a workspace-relative file or folder in the OS default handler (e.g. HTML in the browser).
#[tauri::command]
fn open_workspace_relative_path(
    window: Window,
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let workspace = state.workspace_by_window.lock().unwrap();
    let base = workspace
        .get(&label)
        .ok_or_else(|| "No workspace open".to_string())?;
    let rel = relative_path.trim().trim_start_matches(['/', '\\']);
    let full = base.join(rel);
    let base_canon = fs::canonicalize(base).map_err(|e| e.to_string())?;
    let full_canon = fs::canonicalize(&full).map_err(|e| format!("Path not found: {e}"))?;
    if !full_canon.starts_with(&base_canon) {
        return Err("Path escapes workspace".into());
    }
    open::that(&full_canon).map_err(|e| e.to_string())
}

/// Open an external URL (http/https/file/mailto) using the OS default handler.
#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is empty".into());
    }
    open::that(trimmed).map_err(|e| e.to_string())
}

/// Navigate a named browser preview webview window to a new URL.
#[tauri::command]
fn browser_webview_navigate(
    app: AppHandle,
    label: String,
    url: String,
) -> Result<(), String> {
    let normalized_label = label.trim();
    if normalized_label.is_empty() {
        return Err("label is required".into());
    }
    let normalized_url = url.trim();
    if normalized_url.is_empty() {
        return Err("url is required".into());
    }
    let webview = app
        .get_webview_window(normalized_label)
        .ok_or_else(|| format!("WebviewWindow `{normalized_label}` not found"))?;
    let parsed = normalized_url
        .parse()
        .map_err(|e| format!("Invalid URL `{normalized_url}`: {e}"))?;
    webview
        .navigate(parsed)
        .map_err(|e| format!("Failed to navigate webview `{normalized_label}`: {e}"))
}

/// Open native platform DevTools for a named browser preview window.
#[tauri::command]
fn browser_webview_open_devtools(app: AppHandle, label: String) -> Result<(), String> {
    let normalized_label = label.trim();
    if normalized_label.is_empty() {
        return Err("label is required".into());
    }
    let window = app
        .get_webview_window(normalized_label)
        .ok_or_else(|| format!("WebviewWindow `{normalized_label}` not found"))?;
    window.open_devtools();
    Ok(())
}

/// Close native platform DevTools for a named browser preview window.
#[tauri::command]
fn browser_webview_close_devtools(app: AppHandle, label: String) -> Result<(), String> {
    let normalized_label = label.trim();
    if normalized_label.is_empty() {
        return Err("label is required".into());
    }
    let window = app
        .get_webview_window(normalized_label)
        .ok_or_else(|| format!("WebviewWindow `{normalized_label}` not found"))?;
    window.close_devtools();
    Ok(())
}

/// macOS: open Terminal.app and run `pi` so the user can type `/login` and pick a provider.
/// Other platforms: Pi login is interactive; users should run `pi` in a shell manually.
#[tauri::command]
fn open_pi_cli_in_terminal() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        const SCRIPT: &str = r#"tell application "Terminal"
	activate
	do script "pi"
end tell"#;
        let st = Command::new("osascript")
            .args(["-e", SCRIPT])
            .status()
            .map_err(|e| format!("Could not launch Terminal: {e}"))?;
        if !st.success() {
            return Err("osascript exited with an error".into());
        }
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Open a terminal, install Pi (pi-mono) if needed, run `pi`, then type `/login` and choose your provider.".into())
    }
}

fn sanitize_oneshot_folder_name(name: &str) -> String {
    let s: String = name
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
        .take(48)
        .collect();
    if s.is_empty() {
        "project".to_string()
    } else {
        s
    }
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let path = entry.path();
        let dest_path = dst.join(entry.file_name());
        if path.is_dir() {
            copy_dir_recursive(&path, &dest_path)?;
        } else {
            fs::copy(&path, &dest_path)?;
        }
    }
    Ok(())
}

/// Create a folder under the OS temp directory for one-shot project generation.
#[tauri::command]
fn create_temp_project(name: String) -> Result<String, String> {
    let slug = sanitize_oneshot_folder_name(&name);
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("agent-canvas-oneshot-{slug}-{ts}"));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

/// Recursively copy a project directory to a new path (destination must not exist).
#[tauri::command]
fn copy_project(src: String, dest: String) -> Result<(), String> {
    let src = PathBuf::from(&src);
    let dest = PathBuf::from(&dest);
    if !src.is_dir() {
        return Err("source is not an existing directory".to_string());
    }
    if dest.exists() {
        return Err("destination already exists — pick an empty folder or a new path".to_string());
    }
    copy_dir_recursive(&src, &dest).map_err(|e| e.to_string())
}

/// Delete a one-shot temp folder (must live under OS temp and use our prefix).
#[tauri::command]
fn delete_temp_project(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let p = p.canonicalize().map_err(|e| e.to_string())?;
    let temp = std::env::temp_dir().canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&temp) {
        return Err("refusing to delete outside OS temp directory".to_string());
    }
    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if !name.starts_with("agent-canvas-oneshot-") {
        return Err("refusing to delete: not an agent-canvas-oneshot temp folder".to_string());
    }
    fs::remove_dir_all(&p).map_err(|e| e.to_string())
}

fn is_oneshot_temp_project_dir(p: &PathBuf) -> bool {
    let Ok(p) = p.canonicalize() else {
        return false;
    };
    let Ok(temp) = std::env::temp_dir().canonicalize() else {
        return false;
    };
    if !p.starts_with(&temp) {
        return false;
    }
    let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if !name.starts_with("agent-canvas-oneshot-") {
        return false;
    }
    p.is_dir()
}

/// Absolute path of the OS temp directory (for showing users where 1-shot temps live).
#[tauri::command]
fn oneshot_temp_root_path() -> Result<String, String> {
    std::env::temp_dir()
        .canonicalize()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

/// List `agent-canvas-oneshot-*` directories under the OS temp folder (newest names last by sort).
#[tauri::command]
fn list_oneshot_temp_projects() -> Result<Vec<String>, String> {
    let temp = std::env::temp_dir().canonicalize().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&temp).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if is_oneshot_temp_project_dir(&path) {
            out.push(path.to_string_lossy().to_string());
        }
    }
    out.sort();
    Ok(out)
}

/// Reveal the OS temp folder in Finder / Explorer.
#[tauri::command]
fn open_oneshot_temp_in_file_manager() -> Result<(), String> {
    let temp = std::env::temp_dir().canonicalize().map_err(|e| e.to_string())?;
    open::that(&temp).map_err(|e| e.to_string())
}

/// Delete every `agent-canvas-oneshot-*` directory under the OS temp folder. Returns count removed.
#[tauri::command]
fn delete_all_oneshot_temp_projects() -> Result<usize, String> {
    let paths = list_oneshot_temp_projects()?;
    let mut n = 0usize;
    for path_str in paths {
        delete_temp_project(path_str)?;
        n += 1;
    }
    Ok(n)
}

#[tauri::command]
fn get_ttfp_workspace() -> Option<String> {
    std::env::var("ORCA_TTFP_WORKSPACE").ok().filter(|s| !s.is_empty())
}

#[tauri::command]
fn record_ttfp_marker(stage: String, timestamp_ms: u64) -> Result<(), String> {
    eprintln!("[TTFP] invoked stage={} ts={}", stage, timestamp_ms);
    let path = std::env::var("ORCA_TTFP_LOG").unwrap_or_else(|_| "/tmp/orca-ttfp.log".to_string());
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(f, "{}\t{}", stage, timestamp_ms).map_err(|e| e.to_string())?;
    Ok(())
}

fn ttfp_append(stage: &str, ts: u128) {
    let path = std::env::var("ORCA_TTFP_LOG").unwrap_or_else(|_| "/tmp/orca-ttfp.log".to_string());
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| {
            use std::io::Write;
            writeln!(f, "{}\t{}", stage, ts)
        });
    eprintln!("[TTFP] {} {}", stage, ts);
}

fn ttfp_now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::var_os("ORCA_TTFP").is_some() {
        let t0 = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        eprintln!("[TTFP] T0_PROCESS_START {}", t0);
        let path = std::env::var("ORCA_TTFP_LOG").unwrap_or_else(|_| "/tmp/orca-ttfp.log".to_string());
        let _ = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .and_then(|mut f| {
                use std::io::Write;
                writeln!(f, "T0_PROCESS_START\t{}", t0)
            });
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_http::init())
        .manage(AppState::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                app.handle().plugin(tauri_plugin_positioner::init())?;
                orca_tray::setup_tray(app)?;
                app_menu::install(app.handle())?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            app_menu::handle_menu_event(app, event);
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let label = window.label().to_string();
                if let Some(state) = window.try_state::<AppState>() {
                    kill_ptys_for_window(&state, &label);
                    state.workspace_by_window.lock().unwrap().remove(&label);
                }
            }
        })
        .on_page_load(|_window, payload| {
            if std::env::var_os("ORCA_TTFP").is_some() {
                let stage = match payload.event() {
                    tauri::webview::PageLoadEvent::Started => "T1_WEBVIEW_PAGE_START",
                    tauri::webview::PageLoadEvent::Finished => "T2_WEBVIEW_PAGE_LOADED",
                };
                ttfp_append(stage, ttfp_now_ms());
            }
        })
        .invoke_handler(tauri::generate_handler![
            open_folder_dialog,
            open_file_dialog,
            save_file_dialog,
            app_menu::rebuild_recent_submenu,
            app_menu::sync_native_menu_checks,
            pick_central_brain_folder_dialog,
            start_central_brain_watch,
            central_brain::resolve_default_icloud_brain_path,
            central_brain::central_brain_write_file,
            central_brain::central_brain_read_file,
            central_brain::central_brain_create_dir,
            central_brain::central_brain_collect_markdown_paths,
            central_brain::central_brain_search_markdown,
            set_workspace,
            get_home_dir,
            get_workspace,
            read_directory,
            workspace_grep::workspace_grep,
            read_file,
            read_file_binary,
            save_clipboard_image_temp,
            write_file,
            create_directory,
            delete_path,
            rename_path,
            create_pty_session,
            write_to_pty,
            resize_pty,
            close_pty_session,
            resolve_llm_api_key,
            resolve_llm_base_url,
            resolve_hermes_api_server_key,
            bedrock_invoke::bedrock_invoke_model,
            llm_shell_credential_flags,
            pi_oauth_registry_status,
            open_pi_cli_in_terminal,
            pi_oauth_login_anthropic,
            pi_oauth_login_openai_codex,
            pi_oauth_login_google_gemini_cli,
            get_resource_usage,
            get_git_changelog_snapshot,
            skinnytools_filter,
            probe_hermes_cli,
            run_gh_cli,
            run_agent_browser,
            run_workspace_shell_command,
            git_worktree::git_worktree_add,
            git_worktree::git_worktree_list,
            git_worktree::git_worktree_remove,
            git_worktree::git_merge_branch,
            git_worktree::git_worktree_seed_dotfiles,
            git_worktree::git_worktree_symlink_heavy_dirs,
            open_workspace_relative_path,
            open_external_url,
            browser_webview_navigate,
            browser_webview_open_devtools,
            browser_webview_close_devtools,
            create_temp_project,
            copy_project,
            delete_temp_project,
            oneshot_temp_root_path,
            list_oneshot_temp_projects,
            open_oneshot_temp_in_file_manager,
            delete_all_oneshot_temp_projects,
            orca_bridge::read_orca_bridge_config,
            orca_bridge::focus_orca_main_window,
            orca_bridge::hide_tray_panel_window,
            exit_app,
            obsidian_vaults::obsidian_vaults_snapshot,
            orca_data::orca_mkdir_p,
            orca_data::orca_write_file,
            orca_data::orca_append_file,
            orca_data::orca_read_file,
            orca_data::orca_list_dir,
            orca_data::orca_delete_file,
            orca_data::orca_list_incomplete_sessions,
            orca_index::orca_index_upsert_message,
            orca_index::orca_index_search,
            record_ttfp_marker,
            get_ttfp_workspace,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = app.try_state::<AppState>() {
                    kill_all_ptys(&state);
                }
            }
        });
}
