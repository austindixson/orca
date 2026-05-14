pub fn format_size(size: usize) -> String {
    if size < 1_000 {
        return format!("{size}");
    }
    if size < 1_000_000 {
        return format!("{:.1}K", size as f64 / 1_000.0);
    }
    format!("{:.1}M", size as f64 / 1_000_000.0)
}

/// Head + tail truncation (matches Python `smart_truncate` shape).
pub fn smart_truncate(text: &str, max_size: usize) -> String {
    if text.len() <= max_size {
        return text.to_string();
    }
    let omitted = text.len() - max_size;
    let marker = format!("\n\n[... truncated {omitted} chars ...]\n\n");
    let marker_len = marker.len();
    let available = max_size.saturating_sub(marker_len);
    if available == 0 {
        return text.chars().take(max_size).collect();
    }
    let head_n = (available as f64 * 0.8).floor() as usize;
    let tail_n = available - head_n;
    let n_chars = text.chars().count();
    let head: String = text.chars().take(head_n).collect();
    let skip = n_chars.saturating_sub(tail_n);
    let tail: String = text.chars().skip(skip).collect();
    head + &marker + &tail
}
