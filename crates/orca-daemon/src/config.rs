//! Load `~/.orca/config.toml` (cross-platform).

use std::path::PathBuf;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct OrcaConfig {
    #[serde(default)]
    pub server: ServerSection,
    #[serde(default)]
    pub bridge: BridgeSection,
    #[serde(default)]
    pub harness: HarnessSection,
    #[serde(default)]
    pub daemon: DaemonSection,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ServerSection {
    #[serde(default = "default_port")]
    pub port: u16,
    /// Workspace root for the companion server (default: cwd at daemon start).
    #[serde(default)]
    pub workspace: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BridgeSection {
    #[serde(default)]
    pub token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HarnessSection {
    /// Path to `harness-headless.mjs`. If unset, resolved next to `orcad` or via `ORCA_HARNESS_SCRIPT`.
    #[serde(default)]
    pub script: Option<PathBuf>,
    /// Override node binary (default: `node` on PATH).
    #[serde(default)]
    pub node_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DaemonSection {
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_port() -> u16 {
    3001
}

fn default_log_level() -> String {
    "info".into()
}

impl Default for ServerSection {
    fn default() -> Self {
        Self {
            port: default_port(),
            workspace: None,
        }
    }
}

impl Default for BridgeSection {
    fn default() -> Self {
        Self { token: None }
    }
}

impl Default for HarnessSection {
    fn default() -> Self {
        Self {
            script: None,
            node_path: None,
        }
    }
}

impl Default for DaemonSection {
    fn default() -> Self {
        Self {
            log_level: default_log_level(),
        }
    }
}

impl OrcaConfig {
    pub fn config_path() -> anyhow::Result<PathBuf> {
        let dir = dirs::home_dir()
            .ok_or_else(|| anyhow::anyhow!("no home directory"))?
            .join(".orca");
        Ok(dir.join("config.toml"))
    }

    pub fn load_or_default() -> Self {
        Self::load().unwrap_or_default()
    }

    pub fn load() -> anyhow::Result<Self> {
        let p = Self::config_path()?;
        if !p.exists() {
            return Ok(Self::default());
        }
        let s = std::fs::read_to_string(&p)?;
        let c: Self = toml::from_str(&s)?;
        Ok(c)
    }
}

impl Default for OrcaConfig {
    fn default() -> Self {
        Self {
            server: ServerSection::default(),
            bridge: BridgeSection::default(),
            harness: HarnessSection::default(),
            daemon: DaemonSection::default(),
        }
    }
}

impl OrcaConfig {
    pub fn merge_env(self) -> Self {
        let mut c = self;
        if let Ok(p) = std::env::var("PORT") {
            if let Ok(port) = p.parse::<u16>() {
                c.server.port = port;
            }
        }
        if let Ok(t) = std::env::var("CANVAS_BRIDGE_TOKEN") {
            if !t.trim().is_empty() {
                c.bridge.token = Some(t);
            }
        }
        if let Ok(w) = std::env::var("WORKSPACE_ROOT") {
            if !w.trim().is_empty() {
                c.server.workspace = Some(PathBuf::from(w));
            }
        }
        c
    }
}
