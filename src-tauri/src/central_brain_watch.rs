//! Watch `vault_root/projects/<project_id>/` and emit `central-brain-changed` (debounced).

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CentralBrainChangedPayload {
    pub vault_rel_paths: Vec<String>,
}

fn should_skip_path(p: &Path) -> bool {
    let s = p.to_string_lossy();
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    name.ends_with(".icloud")
        || name == ".DS_Store"
        || s.contains("conflicted copy")
}

/// Strip `vault_root` prefix from `path`; returns POSIX-style relative path.
fn rel_under_vault(vault_root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(vault_root)
        .ok()
        .map(|p| p.to_string_lossy().replace('\\', "/"))
}

/// Spawn a background thread watching `vault_root/projects/<project_id>/` recursively.
pub fn spawn_central_brain_watch(
    app: AppHandle,
    _window_label: String,
    vault_root: String,
    project_id: String,
) {
    std::thread::spawn(move || {
        let vault = PathBuf::from(vault_root.trim());
        if vault_root.trim().is_empty() {
            return;
        }
        let watch_dir = vault.join("projects").join(&project_id);
        if let Err(e) = std::fs::create_dir_all(&watch_dir) {
            log::warn!("central brain watch: mkdir {:?}: {e}", watch_dir);
        }
        let vault_canon = match std::fs::canonicalize(&vault) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("central brain watch: canonicalize vault: {e}");
                return;
            }
        };

        let last_emit = Arc::new(Mutex::new(
            Instant::now()
                .checked_sub(Duration::from_secs(10))
                .unwrap_or_else(Instant::now),
        ));

        let app_for_cb = app.clone();
        let vault_for_cb = vault_canon.clone();

        let mut watcher = match RecommendedWatcher::new(
            {
                let last_emit = last_emit.clone();
                let app = app_for_cb.clone();
                let vault_canon = vault_for_cb.clone();
                move |res: notify::Result<notify::Event>| {
                    if let Ok(event) = res {
                        if matches!(event.kind, EventKind::Access(_)) {
                            return;
                        }
                        let mut rels: Vec<String> = Vec::new();
                        for p in event.paths {
                            if should_skip_path(&p) {
                                continue;
                            }
                            if let Some(rel) = rel_under_vault(&vault_canon, &p) {
                                if rel.starts_with("projects/") {
                                    rels.push(rel);
                                }
                            }
                        }
                        if rels.is_empty() {
                            return;
                        }
                        let mut g = last_emit.lock().unwrap();
                        if g.elapsed() < Duration::from_millis(500) {
                            return;
                        }
                        *g = Instant::now();
                        drop(g);

                        let payload = CentralBrainChangedPayload {
                            vault_rel_paths: rels,
                        };
                        let _ = app.emit("central-brain-changed", payload);
                    }
                }
            },
            Config::default(),
        ) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("central brain watch: {e}");
                return;
            }
        };

        if let Err(e) = watcher.watch(&watch_dir, RecursiveMode::Recursive) {
            log::warn!("central brain watch: failed to watch {:?}: {e}", watch_dir);
            return;
        }

        loop {
            std::thread::sleep(Duration::from_secs(3600));
        }
    });
}
