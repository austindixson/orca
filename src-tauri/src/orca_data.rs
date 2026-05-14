//! Safe read/write under `~/.orca/` (never escapes home data root).

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

fn orca_root() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".orca"))
        .ok_or_else(|| "no home directory".to_string())
}

/// Join `relative` (e.g. `sessions/abc/conversation.jsonl`) under `~/.orca/`.
pub fn safe_orca_path(relative: &str) -> Result<PathBuf, String> {
    let root = orca_root()?;
    let mut p = root.clone();
    for seg in relative.split('/').filter(|s| !s.is_empty()) {
        if seg == ".." || seg.contains("..") || seg.contains('\\') {
            return Err("invalid path segment".to_string());
        }
        p.push(seg);
    }
    if !p.starts_with(&root) {
        return Err("path traversal".to_string());
    }
    Ok(p)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaSessionMeta {
    pub session_id: String,
    pub incomplete: bool,
    pub updated_at_ms: u64,
    pub workspace_root: Option<String>,
    pub progress_percent: Option<u32>,
    pub current_task_number: Option<u32>,
    pub completed_task_count: Option<u32>,
    pub total_task_count: Option<u32>,
}

#[tauri::command]
pub fn orca_mkdir_p(relative: String) -> Result<(), String> {
    let path = safe_orca_path(&relative)?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn orca_write_file(relative: String, content: String) -> Result<(), String> {
    let path = safe_orca_path(&relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn orca_append_file(relative: String, line: String) -> Result<(), String> {
    let path = safe_orca_path(&relative)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    f.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    if !line.ends_with('\n') {
        f.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn orca_read_file(relative: String) -> Result<Option<String>, String> {
    let path = safe_orca_path(&relative)?;
    if !path.exists() {
        return Ok(None);
    }
    if path.is_dir() {
        return Err("path is a directory".to_string());
    }
    fs::read_to_string(&path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn orca_list_dir(relative: String) -> Result<Vec<String>, String> {
    let path = safe_orca_path(&relative)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    if !path.is_dir() {
        return Err("not a directory".to_string());
    }
    let mut entries = Vec::new();
    for e in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        entries.push(e.file_name().to_string_lossy().to_string());
    }
    entries.sort();
    Ok(entries)
}

#[tauri::command]
pub fn orca_delete_file(relative: String) -> Result<(), String> {
    let path = safe_orca_path(&relative)?;
    if path.is_file() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn orca_list_incomplete_sessions() -> Result<Vec<OrcaSessionMeta>, String> {
    let sessions_dir = orca_root()?.join("sessions");
    if !sessions_dir.exists() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for e in fs::read_dir(&sessions_dir).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let name = e.file_name().to_string_lossy().to_string();
        if !e.path().is_dir() {
            continue;
        }
        let meta_rel = format!("sessions/{}/session-meta.json", name);
        let meta_path = safe_orca_path(&meta_rel)?;
        let raw = match fs::read_to_string(&meta_path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();
        let incomplete = v
            .get("incomplete")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let updated_at_ms = v
            .get("updatedAtMs")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("updated_at_ms").and_then(|x| x.as_u64()))
            .unwrap_or(0);
        let workspace_root = v
            .get("workspaceRoot")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                v.get("workspace_root")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string())
            });
        let progress_percent = v
            .get("progressPercent")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("progress_percent").and_then(|x| x.as_u64()))
            .map(|n| n.min(100) as u32);
        let current_task_number = v
            .get("currentTaskNumber")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("current_task_number").and_then(|x| x.as_u64()))
            .map(|n| n.min(u32::MAX as u64) as u32);
        let completed_task_count = v
            .get("completedTaskCount")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("completed_task_count").and_then(|x| x.as_u64()))
            .map(|n| n.min(u32::MAX as u64) as u32);
        let total_task_count = v
            .get("totalTaskCount")
            .and_then(|x| x.as_u64())
            .or_else(|| v.get("total_task_count").and_then(|x| x.as_u64()))
            .map(|n| n.min(u32::MAX as u64) as u32);
        out.push(OrcaSessionMeta {
            session_id: name,
            incomplete,
            updated_at_ms,
            workspace_root,
            progress_percent,
            current_task_number,
            completed_task_count,
            total_task_count,
        });
    }
    out.sort_by(|a, b| b.updated_at_ms.cmp(&a.updated_at_ms));
    Ok(out)
}
