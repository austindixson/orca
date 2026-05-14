//! Read/write under a user-chosen central Obsidian vault path (iCloud OrcaBrain, etc.).
//! Paths are always relative to `vault_root` — never escape via `..`.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::workspace_paths;

fn normalize_vault_rel(rel: &str) -> Result<String, String> {
    let t = rel.trim();
    if t.is_empty() {
        return Err("path is empty".to_string());
    }
    if t.starts_with('/')
        || (t.len() >= 2 && t.as_bytes()[1] == b':' && t.chars().nth(2) == Some('\\'))
    {
        return Err("path must be relative to vault root".to_string());
    }
    let path = Path::new(t);
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::Normal(s) => {
                let seg = s.to_string_lossy();
                if seg == ".." {
                    return Err("path must not contain parent segments (..)".to_string());
                }
                out.push(&*seg);
            }
            Component::ParentDir => {
                return Err("path must not contain parent segments (..)".to_string());
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return Err("invalid path".to_string()),
        }
    }
    Ok(out.to_string_lossy().replace('\\', "/"))
}

fn resolve_path_under_vault(vault_root: &Path, rel: &str) -> Result<PathBuf, String> {
    let norm = normalize_vault_rel(rel)?;
    let joined = vault_root.join(&norm);
    let root_canon = fs::canonicalize(vault_root).map_err(|e| format!("vault root: {}", e))?;

    if joined.exists() {
        let p = fs::canonicalize(&joined).map_err(|e| format!("path: {}", e))?;
        if !p.starts_with(&root_canon) {
            return Err("resolved path escapes vault".to_string());
        }
        return Ok(p);
    }

    let mut anc = joined.clone();
    while !anc.exists() {
        anc = anc
            .parent()
            .ok_or_else(|| "invalid path".to_string())?
            .to_path_buf();
    }
    let anc_canon = fs::canonicalize(&anc).map_err(|e| format!("parent path: {}", e))?;
    if !anc_canon.starts_with(&root_canon) {
        return Err("path escapes vault".to_string());
    }
    Ok(joined)
}

/// Default iCloud Drive path on macOS; `~/OrcaBrain` elsewhere.
#[tauri::command]
pub fn resolve_default_icloud_brain_path() -> String {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .map(|h| {
                h.join("Library/Mobile Documents/com~apple~CloudDocs/OrcaBrain")
                    .to_string_lossy()
                    .to_string()
            })
            .unwrap_or_else(|| "OrcaBrain".to_string())
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::home_dir()
            .map(|h| h.join("OrcaBrain").to_string_lossy().to_string())
            .unwrap_or_else(|| "OrcaBrain".to_string())
    }
}

#[tauri::command]
pub fn central_brain_write_file(vault_root: String, rel_path: String, content: String) -> Result<(), String> {
    let root = PathBuf::from(vault_root.trim());
    fs::create_dir_all(&root).map_err(|e| format!("create vault root: {}", e))?;
    let root_canon = fs::canonicalize(&root).map_err(|e| format!("vault root: {}", e))?;

    if content.len() as u64 > workspace_paths::MAX_WRITE_BYTES {
        return Err(format!(
            "Content too large ({} bytes); max {}",
            content.len(),
            workspace_paths::MAX_WRITE_BYTES
        ));
    }

    let full = resolve_path_under_vault(&root_canon, &rel_path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("mkdir: {}", e))?;
    }
    fs::write(&full, content).map_err(|e| format!("write: {}", e))
}

#[tauri::command]
pub fn central_brain_read_file(vault_root: String, rel_path: String) -> Result<Option<String>, String> {
    let root = PathBuf::from(vault_root.trim());
    if !root.exists() {
        return Ok(None);
    }
    let root_canon = fs::canonicalize(&root).map_err(|e| format!("vault root: {}", e))?;
    let full = resolve_path_under_vault(&root_canon, &rel_path)?;
    if !full.is_file() {
        return Ok(None);
    }
    let meta = fs::metadata(&full).map_err(|e| e.to_string())?;
    if meta.len() > workspace_paths::MAX_READ_BYTES {
        return Err(format!(
            "file too large ({} bytes); max {}",
            meta.len(),
            workspace_paths::MAX_READ_BYTES
        ));
    }
    fs::read_to_string(&full).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn central_brain_create_dir(vault_root: String, rel_path: String) -> Result<(), String> {
    let root = PathBuf::from(vault_root.trim());
    fs::create_dir_all(&root).map_err(|e| format!("create vault root: {}", e))?;
    let root_canon = fs::canonicalize(&root).map_err(|e| format!("vault root: {}", e))?;
    let full = resolve_path_under_vault(&root_canon, &rel_path)?;
    fs::create_dir_all(&full).map_err(|e| format!("mkdir: {}", e))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralBrainMarkdownEntry {
    pub rel_path: String,
    pub snippet: String,
}

fn should_skip_walk_name(name: &str) -> bool {
    name.ends_with(".icloud")
        || name == ".DS_Store"
        || name.contains("conflicted copy")
}

fn walk_md_collect(
    dir: &Path,
    vault_root: &Path,
    prefix_filter: Option<&str>,
    out: &mut Vec<String>,
    cap: usize,
) -> Result<(), String> {
    if out.len() >= cap {
        return Ok(());
    }
    let read = fs::read_dir(dir).map_err(|e| e.to_string())?;
    for e in read {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        if should_skip_walk_name(&name) {
            continue;
        }
        let path = e.path();
        if path.is_dir() {
            walk_md_collect(&path, vault_root, prefix_filter, out, cap)?;
            if out.len() >= cap {
                return Ok(());
            }
        } else if path.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("md")) == Some(true) {
            let rel = path.strip_prefix(vault_root).map_err(|_| "strip prefix".to_string())?;
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            if let Some(pf) = prefix_filter {
                if !rel_s.starts_with(pf) {
                    continue;
                }
            }
            out.push(rel_s);
            if out.len() >= cap {
                return Ok(());
            }
        }
    }
    Ok(())
}

/// Collect up to `max_files` `.md` paths under `vault_root`, optionally filtered by relative prefix (e.g. `projects/`).
#[tauri::command]
pub fn central_brain_collect_markdown_paths(
    vault_root: String,
    prefix: Option<String>,
    max_files: Option<usize>,
) -> Result<Vec<String>, String> {
    let root = PathBuf::from(vault_root.trim());
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let root_canon = fs::canonicalize(&root).map_err(|e| format!("vault root: {}", e))?;
    let cap = max_files.unwrap_or(5000).min(20_000);
    let pf = prefix
        .as_ref()
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty());
    let mut out: Vec<String> = Vec::new();
    walk_md_collect(&root_canon, &root_canon, pf.as_deref(), &mut out, cap)?;
    out.sort();
    Ok(out)
}

/// Keyword search over markdown files (substring match, case-insensitive). Returns snippets.
#[tauri::command]
pub fn central_brain_search_markdown(
    vault_root: String,
    query: String,
    prefix: Option<String>,
    max_hits: Option<usize>,
) -> Result<Vec<CentralBrainMarkdownEntry>, String> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let paths = central_brain_collect_markdown_paths(vault_root.clone(), prefix, Some(8000))?;
    let max = max_hits.unwrap_or(48).min(200);
    let mut hits: Vec<CentralBrainMarkdownEntry> = Vec::new();
    let root = PathBuf::from(vault_root.trim());
    let root_canon = fs::canonicalize(&root).map_err(|e| format!("vault root: {}", e))?;

    for rel in paths {
        if hits.len() >= max {
            break;
        }
        let full = resolve_path_under_vault(&root_canon, &rel)?;
        let mut content = match fs::read_to_string(&full) {
            Ok(c) => c,
            Err(_) => continue,
        };
        if content.len() > 256 * 1024 {
            content.truncate(256 * 1024);
        }
        let low = content.to_lowercase();
        let idx = low.find(&q);
        if let Some(i) = idx {
            let start = i.saturating_sub(100);
            let snippet = content
                .chars()
                .skip(start)
                .take(220)
                .collect::<String>()
                .replace('\n', " ");
            hits.push(CentralBrainMarkdownEntry {
                rel_path: rel,
                snippet: snippet.trim().to_string(),
            });
        }
    }
    Ok(hits)
}
