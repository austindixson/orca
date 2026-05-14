//! Tool-result filter pipeline (inspired by [skinnytools](https://github.com/austindixson/skinnytools)):
//! recursive strip, content-aware compression, JSON compaction, truncation, file redirect.
//! Runs entirely in-process — no Python subprocess.
mod config;
mod content_aware;
mod detector;
mod file_redirect;
mod json_compactor;
mod json_utils;
mod patterns;
mod pipeline;
mod recursive;
mod text;
mod truncator;

pub use pipeline::process;
