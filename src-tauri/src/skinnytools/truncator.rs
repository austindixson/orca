use serde_json::Value;

use crate::skinnytools::config::FilterConfig;
use crate::skinnytools::json_utils::{compact_json, safe_parse};
use crate::skinnytools::text::{format_size, smart_truncate};

pub fn apply(content: &str, config: &FilterConfig) -> String {
    let original_size = content.len();
    if original_size <= config.max_size {
        return content.to_string();
    }

    let result = if let Some(v) = safe_parse(content) {
        truncate_json_value(v, config.max_size)
    } else {
        smart_truncate(content, config.max_size)
    };

    let footer = format!(
        "\n[Truncated: {} → {} chars]",
        format_size(original_size),
        format_size(result.len())
    );
    result + &footer
}

fn truncate_json_value(v: Value, max_size: usize) -> String {
    match v {
        Value::Array(arr) => truncate_array(arr, max_size),
        Value::Object(obj) => {
            let n = obj.len().max(1);
            let s = compact_json(&Value::Object(obj.clone()));
            if s.len() <= max_size {
                return s;
            }
            truncate_object_values(&Value::Object(obj), max_size / n)
        }
        other => {
            let s = compact_json(&other);
            if s.len() <= max_size {
                s
            } else {
                s.chars().take(max_size).collect()
            }
        }
    }
}

fn truncate_array(arr: Vec<Value>, max_size: usize) -> String {
    if arr.len() <= 5 {
        let s = compact_json(&Value::Array(arr.clone()));
        if s.len() <= max_size {
            return s;
        }
    }
    let keep_head = 3.min(arr.len());
    let keep_tail = if arr.len() > 3 { 1 } else { 0 };
    let omitted = arr.len().saturating_sub(keep_head + keep_tail);
    let mut parts = Vec::new();
    for item in arr.iter().take(keep_head) {
        let mut serialized = compact_json(item);
        if serialized.len() > 1000 {
            serialized = match item {
                Value::Object(o) => truncate_object_values(&Value::Object(o.clone()), 500),
                _ => format!("{}...", serialized.chars().take(1000).collect::<String>()),
            };
        }
        parts.push(serialized);
    }
    if omitted > 0 {
        parts.push(format!("\"[...{omitted} more items...]\""));
    }
    if keep_tail > 0 {
        for item in arr.iter().rev().take(keep_tail).rev() {
            let mut serialized = compact_json(item);
            if serialized.len() > 1000 {
                serialized = match item {
                    Value::Object(o) => truncate_object_values(&Value::Object(o.clone()), 500),
                    _ => format!("{}...", serialized.chars().take(1000).collect::<String>()),
                };
            }
            parts.push(serialized);
        }
    }
    format!("[{}]", parts.join(","))
}

fn truncate_object_values(v: &Value, max_value_size: usize) -> String {
    let Value::Object(obj) = v else {
        return compact_json(v);
    };
    let mut truncated = serde_json::Map::new();
    for (k, val) in obj {
        let serialized = compact_json(val);
        if serialized.len() > max_value_size {
            let new_val = match val {
                Value::String(s) => Value::String(format!(
                    "{}...[{} total]",
                    s.chars().take(max_value_size).collect::<String>(),
                    s.len()
                )),
                Value::Array(a) => Value::String(format!("[array, {} items]", a.len())),
                Value::Object(o) => Value::String(format!("{{object, {} keys}}", o.len())),
                x => x.clone(),
            };
            truncated.insert(k.clone(), new_val);
        } else {
            truncated.insert(k.clone(), val.clone());
        }
    }
    compact_json(&Value::Object(truncated))
}
