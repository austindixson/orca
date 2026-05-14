//! Resolve `harness-headless.mjs` next to the `orcad` binary or from env.

use std::path::PathBuf;

pub fn resolve_harness_script(configured: Option<PathBuf>) -> Option<PathBuf> {
    if let Ok(p) = std::env::var("ORCA_HARNESS_SCRIPT") {
        let p = PathBuf::from(p.trim());
        if p.is_file() {
            return Some(p);
        }
    }
    if let Some(p) = configured {
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let next = dir.join("harness-headless.mjs");
            if next.is_file() {
                return Some(next);
            }
            let rel = dir.join("../../packages/harness-headless/dist/harness-headless.mjs");
            if let Ok(c) = rel.canonicalize() {
                if c.is_file() {
                    return Some(c);
                }
            }
        }
    }
    None
}

pub fn log_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library/Logs/Orca")
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("Orca")
            .join("Logs")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".orca")
            .join("logs")
    }
}

pub fn ensure_log_dir() -> std::io::Result<PathBuf> {
    let d = log_dir();
    std::fs::create_dir_all(&d)?;
    Ok(d)
}
