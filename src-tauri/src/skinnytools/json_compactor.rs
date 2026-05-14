use serde_json::Value;

use crate::skinnytools::config::FilterConfig;
use crate::skinnytools::json_utils::{compact_json, safe_parse, strip_empty, strip_nulls};

pub fn apply(content: &str, config: &FilterConfig) -> String {
    let Some(mut v) = safe_parse(content) else {
        return content.to_string();
    };
    v = strip_nulls(v);
    v = strip_empty(v);
    v = strip_metadata_keys(v, config.strip_metadata_keys);
    compact_json(&v)
}

fn strip_metadata_keys(v: Value, keys: &[&str]) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                if keys.contains(&k.as_str()) {
                    continue;
                }
                out.insert(k, strip_metadata_keys(val, keys));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(
            arr.into_iter()
                .map(|item| strip_metadata_keys(item, keys))
                .collect(),
        ),
        other => other,
    }
}
