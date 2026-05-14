//! Debounced filesystem notifications for the current workspace (dev preview reload).
use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;

#[derive(Clone, Serialize)]
struct WorkspaceFsChangedPayload {
    window_label: String,
}

/// Directory segments whose writes MUST NOT trigger a preview reload.
/// These are bookkeeping / build-output / dependency directories — editing
/// source files here never reflects in the user's running preview, and they
/// are written frequently by tools (Vite cache, git, npm, canvas state, our
/// own debug logs), which otherwise creates a reload feedback loop with any
/// browser tile pointed at a local dev server.
const IGNORED_DIR_SEGMENTS: &[&str] = &[
    ".git",
    "node_modules",
    ".agent-canvas",
    ".cursor",
    ".vite",
    ".cache",
    ".turbo",
    ".next",
    ".svelte-kit",
    "dist",
    "build",
    "target",
    ".DS_Store",
    ".idea",
    ".vscode",
];

fn path_is_ignored(path: &Path) -> bool {
    for component in path.components() {
        if let std::path::Component::Normal(seg) = component {
            if let Some(name) = seg.to_str() {
                if IGNORED_DIR_SEGMENTS.iter().any(|ig| *ig == name) {
                    return true;
                }
            }
        }
    }
    false
}

/// Spawn a background thread that watches `path` recursively and emits `workspace-fs-changed` (debounced).
pub fn spawn_workspace_fs_watch(app: AppHandle, window_label: String, path: PathBuf) {
    std::thread::spawn(move || {
        let last_emit = Arc::new(Mutex::new(
            Instant::now()
                .checked_sub(Duration::from_secs(10))
                .unwrap_or_else(Instant::now),
        ));
        let label = window_label.clone();
        let app_for_cb = app.clone();

        let mut watcher = match RecommendedWatcher::new(
            {
                let last_emit = last_emit.clone();
                let app = app_for_cb.clone();
                let window_label = label.clone();
                move |res: notify::Result<notify::Event>| {
                    if let Ok(event) = res {
                        if matches!(event.kind, EventKind::Access(_)) {
                            return;
                        }
                        // If EVERY touched path lives under an ignored bookkeeping
                        // directory (e.g. node_modules, .git, .agent-canvas, .cursor,
                        // Vite cache, build output), skip the emit entirely. Only emit
                        // when at least one changed path is "real" source content.
                        if !event.paths.is_empty()
                            && event.paths.iter().all(|p| path_is_ignored(p))
                        {
                            return;
                        }
                        let mut g = last_emit.lock().unwrap();
                        if g.elapsed() < Duration::from_millis(280) {
                            return;
                        }
                        *g = Instant::now();
                        drop(g);
                        let payload = WorkspaceFsChangedPayload {
                            window_label: window_label.clone(),
                        };
                        let _ = app.emit("workspace-fs-changed", payload);
                    }
                }
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("workspace watch: {e}");
                return;
            }
        };

        if let Err(e) = watcher.watch(&path, RecursiveMode::Recursive) {
            log::warn!("workspace watch: failed to watch {:?}: {e}", path);
            return;
        }

        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}
