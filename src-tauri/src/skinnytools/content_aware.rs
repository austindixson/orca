use regex::Regex;
use once_cell::sync::Lazy;

use crate::skinnytools::config::FilterConfig;
use crate::skinnytools::detector::{detect_content_type, ContentType};

pub fn apply(content: &str, config: &FilterConfig) -> String {
    match detect_content_type(content) {
        ContentType::JsonObject | ContentType::JsonArray => content.to_string(),
        ContentType::LogLines => compress_logs(content, config),
        ContentType::StackTrace => compress_stack_trace(content),
        ContentType::Html => compress_html(content),
        ContentType::Base64 => compress_base64(content),
        ContentType::PlainText => content.to_string(),
    }
}

fn compress_logs(text: &str, config: &FilterConfig) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.len() <= config.max_log_lines {
        return text.to_string();
    }
    let half = config.max_log_lines / 2;
    let head: Vec<&str> = lines.iter().take(half).copied().collect();
    let tail: Vec<&str> = lines.iter().rev().take(half).rev().copied().collect();
    let omitted = lines.len() - config.max_log_lines;
    let middle = &lines[half..lines.len().saturating_sub(half)];
    let repeated = count_repeated_lines(middle);
    let mut summary = vec![format!("[... {omitted} log lines omitted ...]")];
    if !repeated.is_empty() {
        let parts: Vec<String> = repeated
            .into_iter()
            .take(8)
            .map(|(k, v)| format!("{v}x {}", k.chars().take(60).collect::<String>()))
            .collect();
        summary.push(format!("[repeated patterns: {}]", parts.join(", ")));
    }
    head.into_iter()
        .chain(summary.iter().map(String::as_str))
        .chain(tail)
        .collect::<Vec<_>>()
        .join("\n")
}

static RE_TS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}\S*\s*").expect("regex")
});

fn count_repeated_lines(lines: &[&str]) -> std::collections::HashMap<String, usize> {
    use std::collections::HashMap;
    let mut normalized: HashMap<String, usize> = HashMap::new();
    for line in lines {
        let key = RE_TS.replace(line.trim(), "").to_string();
        if key.len() > 10 {
            *normalized.entry(key).or_insert(0) += 1;
        }
    }
    normalized.into_iter().filter(|(_, v)| *v >= 3).collect()
}

fn compress_stack_trace(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.len() <= 10 {
        return text.to_string();
    }
    let head = lines.iter().take(3).copied().collect::<Vec<_>>().join("\n");
    let tail = lines.iter().rev().take(3).rev().copied().collect::<Vec<_>>().join("\n");
    let omitted = lines.len().saturating_sub(6);
    format!("{head}\n    [... {omitted} frames omitted ...]\n{tail}")
}

static RE_SCRIPT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?is)<script[^>]*>[\s\S]*?</script>").expect("regex")
});
static RE_STYLE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?is)<style[^>]*>[\s\S]*?</style>").expect("regex"));
static RE_TAGS: Lazy<Regex> = Lazy::new(|| Regex::new(r"<[^>]+>").expect("regex"));
static RE_WS: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s+").expect("regex"));

fn compress_html(text: &str) -> String {
    let mut t = RE_SCRIPT.replace_all(text, "").to_string();
    t = RE_STYLE.replace_all(&t, "").to_string();
    t = RE_TAGS.replace_all(&t, " ").to_string();
    RE_WS.replace_all(&t, " ").trim().to_string()
}

static RE_BASE64_BLOB: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9+/]{200,}={0,2}").expect("regex"));

fn compress_base64(text: &str) -> String {
    RE_BASE64_BLOB
        .replace_all(text, |cap: &regex::Captures| {
            let m = cap.get(0).unwrap();
            format!("[base64 data, {} chars]", m.as_str().len())
        })
        .to_string()
}
