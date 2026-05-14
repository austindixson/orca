use once_cell::sync::Lazy;
use regex::Regex;

use crate::skinnytools::text::format_size;

pub struct RecursivePattern {
    pub name: &'static str,
    pub regex: &'static Lazy<Regex>,
    pub min_match_size: usize,
}

pub fn replacement_for_match(name: &'static str, matched_len: usize) -> String {
    format!("[STRIPPED:{name}, {} chars]", format_size(matched_len))
}

// Mirrors vendor/skinnytools/core/patterns.py (order matters).
/// Rust `regex` has no lookahead; this is a slightly looser variant of the Python pattern.
static RE_ESCAPED_CONVERSATION: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)(?:\\"){1,}role(?:\\"){1,}\s*:\s*(?:\\"){1,}(?:assistant|user|system)(?:\\"){1,}[^"]{500,}"#,
    )
    .expect("regex")
});

static RE_NESTED_TOOL_RESULT: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)"(?:toolResult|tool_result)"\s*:\s*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[\s\S]{500,}?\])"#,
    )
    .expect("regex")
});

static RE_THINKING_BLOCKS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)(?:"type"\s*:\s*"thinking"\s*,\s*"thinking"\s*:\s*"[^"]{500,}?"|<thinking>[\s\S]{500,}?</thinking>)"#,
    )
    .expect("regex")
});

static RE_BASE64_BLOBS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[A-Za-z0-9+/]{500,}={0,2}").expect("regex"));

static RE_SESSION_ARRAYS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?s)"(?:messages|conversation|session|history)"\s*:\s*\[[\s\S]{1000,}?\]\s*[,}]"#,
    )
    .expect("regex")
});

pub static PATTERNS: &[RecursivePattern] = &[
    RecursivePattern {
        name: "escaped_conversation",
        regex: &RE_ESCAPED_CONVERSATION,
        min_match_size: 1024,
    },
    RecursivePattern {
        name: "session_array",
        regex: &RE_SESSION_ARRAYS,
        min_match_size: 2048,
    },
    RecursivePattern {
        name: "nested_tool_result",
        regex: &RE_NESTED_TOOL_RESULT,
        min_match_size: 512,
    },
    RecursivePattern {
        name: "thinking_block",
        regex: &RE_THINKING_BLOCKS,
        min_match_size: 500,
    },
    RecursivePattern {
        name: "base64_blob",
        regex: &RE_BASE64_BLOBS,
        min_match_size: 500,
    },
];

static ALREADY_STRIPPED: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[STRIPPED:").expect("regex"));

pub fn check_string_for_recursion(value: &str, min_size: usize) -> Option<String> {
    if value.len() < min_size {
        return None;
    }
    if ALREADY_STRIPPED.is_match(value) {
        return None;
    }
    for p in PATTERNS {
        if value.len() < p.min_match_size {
            continue;
        }
        if let Some(m) = p.regex.find(value) {
            if m.as_str().len() >= p.min_match_size {
                return Some(format!(
                    "[STRIPPED:{}, {} chars]",
                    p.name,
                    format_size(value.len())
                ));
            }
        }
    }
    None
}

/// Replace pattern matches from end to start (preserves indices).
pub fn apply_patterns_raw(text: &str, min_size: usize) -> (String, usize) {
    if text.len() < min_size {
        return (text.to_string(), 0);
    }
    let mut result = text.to_string();
    let mut total = 0usize;
    for p in PATTERNS {
        if result.len() < p.min_match_size {
            continue;
        }
        let ranges: Vec<(usize, usize)> = p
            .regex
            .find_iter(&result)
            .filter(|m| m.as_str().len() >= p.min_match_size)
            .map(|m| (m.start(), m.end()))
            .collect();
        for (start, end) in ranges.into_iter().rev() {
            let rep = replacement_for_match(p.name, end - start);
            result.replace_range(start..end, &rep);
            total += 1;
        }
    }
    (result, total)
}
