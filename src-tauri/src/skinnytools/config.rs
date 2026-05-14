#[derive(Clone)]
pub struct FilterConfig {
    pub max_size: usize,
    pub redirect_threshold: usize,
    pub min_match_size: usize,
    pub strip_metadata_keys: &'static [&'static str],
    pub max_log_lines: usize,
}

impl Default for FilterConfig {
    fn default() -> Self {
        Self {
            max_size: 50_000,
            redirect_threshold: 100_000,
            min_match_size: 1024,
            strip_metadata_keys: &[
                "_links", "_meta", "_embedded", "xmlns", "$schema",
            ],
            max_log_lines: 50,
        }
    }
}
