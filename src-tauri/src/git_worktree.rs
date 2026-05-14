//! Git worktree helpers for isolated sub-agent trees (runs `git` from workspace root).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{State, Window};

use crate::AppState;
use crate::workspace_paths::{normalize_relative_workspace_path, resolve_under_workspace};

#[derive(Debug, Serialize, Deserialize)]
pub struct GitWorktreeAddResult {
    pub ok: bool,
    /// Absolute filesystem path of the new worktree.
    pub path: String,
    pub branch: String,
    pub stdout: String,
    pub stderr: String,
}

fn workspace_root(state: &AppState, window_label: &str) -> Result<PathBuf, String> {
    let map = state.workspace_by_window.lock().unwrap();
    map.get(window_label)
        .cloned()
        .ok_or_else(|| "No workspace folder open — open a project first.".to_string())
}

fn sanitize_branch_name(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err("branch name is empty".to_string());
    }
    if t.len() > 200 {
        return Err("branch name too long (max 200)".to_string());
    }
    for c in t.chars() {
        if c.is_alphanumeric() || c == '-' || c == '_' || c == '/' || c == '.' {
            continue;
        }
        return Err(format!(
            "branch name contains invalid character: {:?}",
            c
        ));
    }
    Ok(t.to_string())
}

/// Create a new worktree under the workspace at `relative_path` (e.g. `.worktrees/agent-abc`).
/// Runs `git worktree add -b <branch> <path>` from the workspace root (must be a git repo).
#[tauri::command]
pub async fn git_worktree_add(
    window: Window,
    relative_path: String,
    branch_name: Option<String>,
    state: State<'_, AppState>,
) -> Result<GitWorktreeAddResult, String> {
    let label = window.label().to_string();
    let root = workspace_root(&state, &label)?;

    let rel = normalize_relative_workspace_path(&relative_path)?;
    let target = resolve_under_workspace(&root, &rel)?;

    if target.exists() {
        return Err(format!(
            "worktree path already exists: {}",
            target.display()
        ));
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create parent dirs: {e}"))?;
    }

    let branch = match branch_name {
        Some(b) => sanitize_branch_name(&b)?,
        None => {
            let ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0);
            format!("orca-wt-{ms}")
        }
    };

    let target_str = target.to_string_lossy().to_string();
    let root_clone = root.clone();
    let branch_clone = branch.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("git");
        cmd.arg("worktree");
        cmd.arg("add");
        cmd.arg("-b");
        cmd.arg(&branch_clone);
        cmd.arg(&target_str);
        cmd.current_dir(&root_clone);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = cmd
            .output()
            .map_err(|e| format!("failed to run `git worktree add`: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(format!(
                "git worktree add failed ({}): {}",
                output.status.code().unwrap_or(-1),
                if stderr.is_empty() {
                    stdout.clone()
                } else {
                    stderr.clone()
                }
            ));
        }

        Ok(GitWorktreeAddResult {
            ok: true,
            path: target_str,
            branch: branch_clone,
            stdout,
            stderr,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// `git worktree list` from workspace root.
#[tauri::command]
pub async fn git_worktree_list(window: Window, state: State<'_, AppState>) -> Result<String, String> {
    let label = window.label().to_string();
    let root = workspace_root(&state, &label)?;

    tauri::async_runtime::spawn_blocking(move || {
        let output = Command::new("git")
            .args(["worktree", "list"])
            .current_dir(&root)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("failed to run `git worktree list`: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            return Err(format!(
                "git worktree list failed: {}",
                if stderr.is_empty() {
                    stdout
                } else {
                    stderr
                }
            ));
        }
        Ok(stdout)
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Remove a worktree by workspace-relative path (directory inside the repo / linked worktree path).
#[tauri::command]
pub async fn git_worktree_remove(
    window: Window,
    relative_path: String,
    force: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let label = window.label().to_string();
    let root = workspace_root(&state, &label)?;

    let rel = normalize_relative_workspace_path(&relative_path)?;
    let target = resolve_under_workspace(&root, &rel)?;

    if !target.exists() {
        return Err(format!("worktree path not found: {}", target.display()));
    }

    let target_str = target.to_string_lossy().to_string();
    let root_clone = root.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new("git");
        cmd.arg("worktree");
        cmd.arg("remove");
        if force {
            cmd.arg("--force");
        }
        cmd.arg(&target_str);
        cmd.current_dir(&root_clone);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let output = cmd
            .output()
            .map_err(|e| format!("failed to run `git worktree remove`: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).to_string();
            return Err(format!(
                "git worktree remove failed: {}",
                if stderr.is_empty() {
                    stdout
                } else {
                    stderr
                }
            ));
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GitMergeBranchResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Merge `branch` into the current branch at the workspace root (`git merge --no-ff`).
#[tauri::command]
pub async fn git_merge_branch(
    window: Window,
    branch: String,
    state: State<'_, AppState>,
) -> Result<GitMergeBranchResult, String> {
    let label = window.label().to_string();
    let root = workspace_root(&state, &label)?;
    let b = branch.trim().to_string();
    if b.is_empty() {
        return Err("branch name is empty".to_string());
    }
    let root_clone = root.clone();
    let branch_clone = b.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let msg = format!("Orca: merge agent branch {}", branch_clone);
        let output = Command::new("git")
            .args([
                "merge",
                "--no-ff",
                "-m",
                msg.as_str(),
                branch_clone.as_str(),
            ])
            .current_dir(&root_clone)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("failed to run `git merge`: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        if !output.status.success() {
            return Err(format!(
                "git merge failed ({}): {}",
                output.status.code().unwrap_or(-1),
                if stderr.is_empty() {
                    stdout
                } else {
                    stderr
                }
            ));
        }
        Ok(GitMergeBranchResult {
            ok: true,
            stdout,
            stderr,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

/// Copy `orca.md` / `CLAUDE.md` and `.env` from workspace root into a worktree if missing (best-effort).
#[tauri::command]
pub async fn git_worktree_seed_dotfiles(
    window: Window,
    relative_worktree: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let label = window.label().to_string();
    let root = workspace_root(&state, &label)?;
    let rel = normalize_relative_workspace_path(&relative_worktree)?;
    let wt = resolve_under_workspace(&root, &rel)?;
    if !wt.is_dir() {
        return Err(format!("worktree not found: {}", wt.display()));
    }

    let mut copied = Vec::new();
    for name in ["orca.md", "CLAUDE.md", ".env"] {
        let src = root.join(name);
        let dst = wt.join(name);
        if src.is_file() && !dst.exists() {
            match fs::copy(&src, &dst) {
                Ok(_) => copied.push(format!("copied {name}")),
                Err(e) => copied.push(format!("{name}: {e}")),
            }
        }
    }
    Ok(copied)
}

/// On Unix, symlink `node_modules` / `.cache` / `dist` from repo root into worktree when missing.
#[tauri::command]
pub async fn git_worktree_symlink_heavy_dirs(
    window: Window,
    relative_worktree: String,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    #[cfg(not(unix))]
    {
        let _ = (window, relative_worktree, state);
        return Ok(vec!["symlink: skipped (non-Unix)".to_string()]);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let label = window.label().to_string();
        let root = workspace_root(&state, &label)?;
        let rel = normalize_relative_workspace_path(&relative_worktree)?;
        let wt = resolve_under_workspace(&root, &rel)?;
        if !wt.is_dir() {
            return Err(format!("worktree not found: {}", wt.display()));
        }

        let mut out = Vec::new();
        for dir in ["node_modules", ".cache", "dist"] {
            let src = root.join(dir);
            let dst = wt.join(dir);
            if src.is_dir() && !dst.exists() {
                // wt is `.orca/worktrees/<id>` — three levels up to repo root.
                let target = format!("../../../{}", dir);
                match symlink(&target, &dst) {
                    Ok(_) => out.push(format!("{dir} -> {target}")),
                    Err(e) => out.push(format!("{dir}: {e}")),
                }
            }
        }
        Ok(out)
    }
}
