use crate::skinnytools::config::FilterConfig;
use crate::skinnytools::content_aware;
use crate::skinnytools::file_redirect;
use crate::skinnytools::json_compactor;
use crate::skinnytools::recursive;
use crate::skinnytools::truncator;

/// Run the full filter chain (matches Python `PipelineConfig` defaults).
pub fn process(input: &str) -> String {
    const MAX_INPUT: usize = 100_000_000;
    if input.len() > MAX_INPUT {
        return input.to_string();
    }

    let config = FilterConfig::default();
    let mut current = recursive::apply(input, &config);
    current = content_aware::apply(&current, &config);
    current = json_compactor::apply(&current, &config);
    current = truncator::apply(&current, &config);
    file_redirect::apply(&current, &config)
}

#[cfg(test)]
mod tests {
    use super::process;

    #[test]
    fn json_compactor_strips_nulls() {
        let out = process(r#"{"a":null,"b":1}"#);
        assert!(!out.contains("null"));
        assert!(out.contains("\"b\":1"));
    }
}
