//! Resolve user-supplied relative paths strictly under the workspace root.
//! Prevents `..` segments and symlink escapes outside the workspace.

use std::fs;
use std::path::{Component, Path, PathBuf};

pub const MAX_READ_BYTES: u64 = 1_048_576; // 1 MiB text cap for orchestrator reads
pub const MAX_WRITE_BYTES: u64 = 2_097_152; // 2 MiB write cap

/// Reject paths with `..` or absolute roots after normalization.
pub fn normalize_relative_workspace_path(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err("path is empty".to_string());
    }
    if t.starts_with('/') || (t.len() >= 2 && t.as_bytes()[1] == b':' && t.chars().nth(2) == Some('\\')) {
        return Err("path must be relative to workspace root, not absolute".to_string());
    }
    let path = Path::new(t);
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::Normal(s) => {
                let seg = s.to_string_lossy();
                if seg == ".." {
                    return Err("path must not contain parent directory segments (..)".to_string());
                }
                out.push(&*seg);
            }
            Component::ParentDir => {
                return Err("path must not contain parent directory segments (..)".to_string());
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => {
                return Err("invalid path".to_string());
            }
        }
    }
    Ok(out.to_string_lossy().replace('\\', "/"))
}

/// Join workspace root with a safe relative path; verify result stays under `root` (canonicalized).
pub fn resolve_under_workspace(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let norm = normalize_relative_workspace_path(rel)?;
    let joined = root.join(&norm);
    let root_canon = fs::canonicalize(root).map_err(|e| format!("workspace root: {}", e))?;

    if joined.exists() {
        let p = fs::canonicalize(&joined).map_err(|e| format!("path: {}", e))?;
        if !p.starts_with(&root_canon) {
            return Err("resolved path escapes workspace".to_string());
        }
        return Ok(p);
    }

    // New file: walk up until an existing ancestor; it must be under root.
    let mut anc = joined.clone();
    while !anc.exists() {
        anc = anc
            .parent()
            .ok_or_else(|| "invalid path".to_string())?
            .to_path_buf();
    }
    let anc_canon = fs::canonicalize(&anc).map_err(|e| format!("parent path: {}", e))?;
    if !anc_canon.starts_with(&root_canon) {
        return Err("path escapes workspace".to_string());
    }
    Ok(joined)
}

pub fn sniff_binary_utf8(bytes: &[u8]) -> bool {
    let scan = bytes.len().min(8192);
    bytes[..scan].contains(&0)
}
