use std::fs;
use std::io::Write;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::skinnytools::config::FilterConfig;
use crate::skinnytools::text::format_size;

const REDIRECT_MAX_AGE_SECS: u64 = 3600;

pub fn apply(content: &str, config: &FilterConfig) -> String {
    let original_size = content.len();
    if original_size <= config.redirect_threshold {
        return content.to_string();
    }

    cleanup_old_redirects();

    let Some(dir) = redirect_dir() else {
        return content.to_string();
    };
    let _ = fs::create_dir_all(&dir);

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("skinnytools_{ts}.txt"));

    if let Ok(mut f) = fs::File::create(&path) {
        let _ = f.write_all(content.as_bytes());
    }

    let preview: String = content.chars().take(500).collect::<String>().replace('\n', " ");
    format!(
        "[Full output saved to {} ({} chars)]\nPreview: {preview}...",
        path.display(),
        format_size(original_size)
    )
}

fn redirect_dir() -> Option<std::path::PathBuf> {
    let base = dirs::cache_dir().unwrap_or_else(std::env::temp_dir);
    Some(base.join("skinnytools").join("redirects"))
}

fn cleanup_old_redirects() {
    let Some(dir) = redirect_dir() else {
        return;
    };
    if !dir.is_dir() {
        return;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for e in entries.flatten() {
        let p = e.path();
        if !p.is_file() {
            continue;
        }
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        if !name.starts_with("skinnytools_") {
            continue;
        }
        if let Ok(meta) = p.metadata() {
            if let Ok(modified) = meta.modified() {
                if let Ok(age) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                    if now.saturating_sub(age.as_secs()) > REDIRECT_MAX_AGE_SECS {
                        let _ = fs::remove_file(p);
                    }
                }
            }
        }
    }
}
