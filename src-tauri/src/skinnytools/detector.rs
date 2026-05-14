use regex::Regex;
use once_cell::sync::Lazy;

use crate::skinnytools::json_utils::safe_parse;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ContentType {
    JsonObject,
    JsonArray,
    LogLines,
    StackTrace,
    Html,
    Base64,
    PlainText,
}

static RE_LOG: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?m)^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}").expect("regex")
});
static RE_STACK: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?m)(?:Traceback \(most recent call last\)|^\s+at\s+\S+\(|^\s+File ".+", line \d+)"#,
    )
    .expect("regex")
});
static RE_HTML: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)<(?:html|div|span|p|body|head)\b").expect("regex"));
static RE_BASE64_LINE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?m)^[A-Za-z0-9+/]{200,}={0,2}$").expect("regex"));

pub fn detect_content_type(text: &str) -> ContentType {
    let stripped = text.trim();
    if stripped.is_empty() {
        return ContentType::PlainText;
    }
    if let Some(v) = safe_parse(stripped) {
        return match v {
            serde_json::Value::Object(_) => ContentType::JsonObject,
            _ => ContentType::JsonArray,
        };
    }
    if RE_STACK.is_match(stripped) {
        return ContentType::StackTrace;
    }
    if RE_HTML.is_match(stripped) {
        return ContentType::Html;
    }
    let sample = stripped.chars().take(5000).collect::<String>();
    let log_matches = RE_LOG.find_iter(&sample).count();
    let lines = sample.matches('\n').count() + 1;
    if log_matches > 3 && lines > 0 && (log_matches as f64 / lines as f64) > 0.3 {
        return ContentType::LogLines;
    }
    if RE_BASE64_LINE.is_match(stripped) {
        return ContentType::Base64;
    }
    ContentType::PlainText
}
