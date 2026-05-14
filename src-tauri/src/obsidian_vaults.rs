//! Read Obsidian desktop `obsidian.json` vault registry (same paths as the Obsidian app).
//! See: `~/Library/Application Support/obsidian/obsidian.json` (macOS), etc.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVaultEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    /// True when the folder exists on disk.
    pub path_exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVaultsSnapshot {
    /// Best-effort: Obsidian.app present (macOS), or common Windows path. False on Linux / if unknown.
    pub obsidian_app_installed: bool,
    /// `obsidian.json` was found and read.
    pub config_file_found: bool,
    pub config_path: Option<String>,
    pub vaults: Vec<ObsidianVaultEntry>,
}

fn obsidian_config_paths() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    #[cfg(target_os = "macos")]
    {
        vec![home.join("Library/Application Support/obsidian/obsidian.json")]
    }
    #[cfg(target_os = "linux")]
    {
        vec![home.join(".config/obsidian/obsidian.json")]
    }
    #[cfg(target_os = "windows")]
    {
        let mut v = Vec::new();
        if let Ok(app) = std::env::var("APPDATA") {
            v.push(PathBuf::from(app).join("obsidian").join("obsidian.json"));
        }
        v.push(home.join("AppData/Roaming/obsidian/obsidian.json"));
        v
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "windows"
    )))]
    {
        Vec::new()
    }
}

fn obsidian_app_installed_hint() -> bool {
    #[cfg(target_os = "macos")]
    {
        Path::new("/Applications/Obsidian.app").exists()
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            let p = PathBuf::from(&local)
                .join("Programs")
                .join("Obsidian")
                .join("Obsidian.exe");
            if p.exists() {
                return true;
            }
        }
        Path::new(r"C:\Program Files\obsidian\Obsidian.exe").exists()
            || Path::new(r"C:\Program Files (x86)\obsidian\Obsidian.exe").exists()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        false
    }
}

fn vault_display_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Vault")
        .to_string()
}

fn parse_vaults_json(text: &str) -> Vec<ObsidianVaultEntry> {
    let Ok(root) = serde_json::from_str::<Value>(text) else {
        return Vec::new();
    };
    let Some(vaults) = root.get("vaults").and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    let mut seen_paths = HashSet::<String>::new();
    let mut out = Vec::new();

    for (id, entry) in vaults {
        let Some(path_str) = entry.get("path").and_then(|p| p.as_str()) else {
            continue;
        };
        let path = path_str.trim().to_string();
        if path.is_empty() {
            continue;
        }
        let key = path.replace('\\', "/");
        if seen_paths.contains(&key) {
            continue;
        }
        seen_paths.insert(key);

        let path_exists = Path::new(&path).is_dir();
        let name = vault_display_name(&path);

        out.push(ObsidianVaultEntry {
            id: id.clone(),
            path,
            name,
            path_exists,
        });
    }

    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Snapshot of Obsidian installation hint + vault list from `obsidian.json`.
#[tauri::command]
pub fn obsidian_vaults_snapshot() -> ObsidianVaultsSnapshot {
    let obsidian_app_installed = obsidian_app_installed_hint();

    let mut config_path: Option<String> = None;
    let mut vaults: Vec<ObsidianVaultEntry> = Vec::new();

    for p in obsidian_config_paths() {
        if !p.is_file() {
            continue;
        }
        let Ok(text) = fs::read_to_string(&p) else {
            continue;
        };
        config_path = Some(p.to_string_lossy().to_string());
        vaults = parse_vaults_json(&text);
        break;
    }

    ObsidianVaultsSnapshot {
        obsidian_app_installed,
        config_file_found: config_path.is_some(),
        config_path,
        vaults,
    }
}
