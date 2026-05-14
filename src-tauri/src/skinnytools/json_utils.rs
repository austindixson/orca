use serde_json::Value;

pub fn safe_parse(text: &str) -> Option<Value> {
    serde_json::from_str(text.trim()).ok()
}

pub fn compact_json(v: &Value) -> String {
    serde_json::to_string(v).unwrap_or_else(|_| "{}".to_string())
}

pub fn strip_nulls(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                if val.is_null() {
                    continue;
                }
                out.insert(k, strip_nulls(val));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(
            arr.into_iter()
                .filter(|x| !x.is_null())
                .map(strip_nulls)
                .collect(),
        ),
        other => other,
    }
}

pub fn strip_empty(v: Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, val) in map {
                let val = strip_empty(val);
                if val.is_null()
                    || val == Value::String(String::new())
                    || val == Value::Array(vec![])
                    || val == Value::Object(serde_json::Map::new())
                {
                    continue;
                }
                out.insert(k, val);
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(
            arr.into_iter()
                .filter_map(|item| {
                    let item = strip_empty(item);
                    if item.is_null()
                        || item == Value::String(String::new())
                        || item == Value::Array(vec![])
                        || item == Value::Object(serde_json::Map::new())
                    {
                        None
                    } else {
                        Some(item)
                    }
                })
                .collect(),
        ),
        other => other,
    }
}
