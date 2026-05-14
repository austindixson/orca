use serde_json::Value;

use crate::skinnytools::config::FilterConfig;
use crate::skinnytools::json_utils::compact_json;
use crate::skinnytools::patterns::{apply_patterns_raw, check_string_for_recursion};

pub fn apply(content: &str, config: &FilterConfig) -> String {
    let original_size = content.len();
    if original_size < config.min_match_size {
        return content.to_string();
    }

    // Strategy 1: JSON root object/array — walk string leaves (matches Python).
    if let Ok(mut v) = serde_json::from_str::<Value>(content) {
        let count = match &v {
            Value::Object(_) | Value::Array(_) => walk_json_strings(&mut v, config.min_match_size),
            _ => 0,
        };
        if count > 0 {
            return compact_json(&v);
        }
    }

    // Strategy 2: regex on raw text
    let (result, _) = apply_patterns_raw(content, config.min_match_size);
    result
}

fn walk_json_strings(v: &mut Value, min_size: usize) -> usize {
    let mut count = 0usize;
    match v {
        Value::Object(map) => {
            for (_, val) in map.iter_mut() {
                count += walk_json_strings(val, min_size);
            }
        }
        Value::Array(arr) => {
            for item in arr.iter_mut() {
                count += walk_json_strings(item, min_size);
            }
        }
        Value::String(s) => {
            if s.len() >= min_size {
                if let Some(rep) = check_string_for_recursion(s, min_size) {
                    *s = rep;
                    count += 1;
                }
            }
        }
        _ => {}
    }
    count
}
