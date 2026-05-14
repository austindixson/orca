//! Read `~/.orca/config.toml` + keyring so the menu-bar panel can call the companion API.

use serde::Deserialize;
use serde::Serialize;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct OrcaBridgeConfig {
    pub base_url: String,
    pub token: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FileCfg {
    #[serde(default)]
    server: ServerSec,
    #[serde(default)]
    bridge: BridgeSec,
}

#[derive(Debug, Deserialize, Default)]
struct ServerSec {
    #[serde(default = "default_port")]
    port: u16,
}

#[derive(Debug, Deserialize, Default)]
struct BridgeSec {
    #[serde(default)]
    token: Option<String>,
}

fn default_port() -> u16 {
    3001
}

fn config_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".orca").join("config.toml"))
}

/// Bridge URL + bearer token for `http://127.0.0.1:<port>/api/*` (same as `orca` CLI).
#[tauri::command]
pub fn read_orca_bridge_config() -> Result<OrcaBridgeConfig, String> {
    let path = config_path().ok_or_else(|| "no home directory".to_string())?;
    if !path.exists() {
        return Ok(OrcaBridgeConfig {
            base_url: "http://127.0.0.1:3001".into(),
            token: None,
        });
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let cfg: FileCfg = toml::from_str(&raw).map_err(|e| format!("parse config: {e}"))?;
    let port = if cfg.server.port == 0 {
        3001
    } else {
        cfg.server.port
    };
    let mut token = cfg.bridge.token.filter(|t| !t.trim().is_empty());
    if token.is_none() {
        token = keyring::Entry::new("orca", "canvas_bridge_token")
            .ok()
            .and_then(|e| e.get_password().ok())
            .filter(|s| !s.trim().is_empty());
    }
    Ok(OrcaBridgeConfig {
        base_url: format!("http://127.0.0.1:{port}"),
        token,
    })
}

#[tauri::command]
pub fn focus_orca_main_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        w.show().map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn hide_tray_panel_window(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("tray-panel") {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
