//! Line-oriented workspace search (`.gitignore`-aware) for orchestrator tools.

use crate::AppState;
use crate::workspace_path_for_window;
use globset::Glob;
use ignore::WalkBuilder;
use regex::Regex;
use regex::RegexBuilder;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::State;
use tauri::Window;

use crate::workspace_paths;

const MAX_GREP_FILE_BYTES: u64 = workspace_paths::MAX_READ_BYTES;
const MAX_LINE_CHARS: usize = 800;
const MAX_SCANNED_FILES: u32 = 200_000;

#[derive(Serialize, Clone)]
pub struct GrepMatch {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[derive(Serialize)]
pub struct WorkspaceGrepResponse {
    pub matches: Vec<GrepMatch>,
    pub truncated: bool,
    pub scanned_files: u32,
    pub match_count: usize,
    pub note: Option<String>,
}

fn compile_regex(
    pattern: &str,
    fixed_string: bool,
    case_insensitive: bool,
) -> Result<Regex, String> {
    let re_src = if fixed_string {
        regex::escape(pattern)
    } else {
        pattern.to_string()
    };
    let mut b = RegexBuilder::new(&re_src);
    b.case_insensitive(case_insensitive);
    b.build().map_err(|e| format!("invalid pattern: {e}"))
}

fn run_workspace_grep_sync(
    re: &Regex,
    base_canon: PathBuf,
    start_dir: PathBuf,
    glob_matcher: Option<globset::GlobMatcher>,
    max_matches: usize,
) -> Result<WorkspaceGrepResponse, String> {
    let mut matches: Vec<GrepMatch> = Vec::new();
    let mut scanned: u32 = 0;
    let mut truncated = false;

    let walk = WalkBuilder::new(&start_dir)
        .git_ignore(true)
        .git_exclude(true)
        .hidden(true)
        .build();

    for w in walk {
        if matches.len() >= max_matches {
            truncated = true;
            break;
        }
        if scanned >= MAX_SCANNED_FILES {
            truncated = true;
            break;
        }

        let entry = w.map_err(|e| e.to_string())?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let path = entry.path();
        let meta = fs::metadata(path).map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.len() > MAX_GREP_FILE_BYTES {
            continue;
        }
        if let Some(ref m) = glob_matcher {
            let rel = path.strip_prefix(&base_canon).unwrap_or(path);
            let rel_s = rel.to_string_lossy().replace('\\', "/");
            if !m.is_match(&rel_s) {
                continue;
            }
        }

        let bytes = fs::read(path).map_err(|e| e.to_string())?;
        if workspace_paths::sniff_binary_utf8(&bytes) {
            continue;
        }
        let text = match String::from_utf8(bytes) {
            Ok(s) => s,
            Err(_) => continue,
        };

        scanned = scanned.saturating_add(1);

        let rel_path = path
            .strip_prefix(&base_canon)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        for (i, line) in text.split('\n').enumerate() {
            if matches.len() >= max_matches {
                truncated = true;
                break;
            }
            let n = (i + 1) as u32;
            if re.is_match(line) {
                let t = if line.chars().count() > MAX_LINE_CHARS {
                    format!("{}…", line.chars().take(MAX_LINE_CHARS).collect::<String>())
                } else {
                    line.to_string()
                };
                matches.push(GrepMatch {
                    path: rel_path.clone(),
                    line: n,
                    text: t,
                });
            }
        }
    }

    let note = if truncated {
        Some(
            "Stopped early: max_matches, max scanned files, or file limit. Narrow `path`/`glob` or raise `max_matches`."
                .to_string(),
        )
    } else {
        None
    };
    let match_count = matches.len();
    Ok(WorkspaceGrepResponse {
        matches,
        truncated,
        scanned_files: scanned,
        match_count,
        note,
    })
}

#[tauri::command]
pub async fn workspace_grep(
    window: Window,
    state: State<'_, AppState>,
    path: String,
    pattern: String,
    fixed_string: Option<bool>,
    case_insensitive: Option<bool>,
    glob: Option<String>,
    max_matches: Option<u32>,
) -> Result<WorkspaceGrepResponse, String> {
    let t = pattern.trim();
    if t.is_empty() {
        return Err("pattern required".to_string());
    }
    let sub_path = if path.trim().is_empty() {
        "."
    } else {
        path.as_str()
    }
    .trim();
    let label = window.label().to_string();
    let base_path = workspace_path_for_window(&*state, &label);
    let max_m = max_matches
        .map(|m| m as usize)
        .unwrap_or(200)
        .clamp(1, 2_000);

    let re = compile_regex(
        t,
        fixed_string.unwrap_or(false),
        case_insensitive.unwrap_or(false),
    )?;

    let full_start = if sub_path == "." || sub_path.is_empty() {
        base_path
            .canonicalize()
            .map_err(|e| format!("workspace: {e}"))?
    } else {
        workspace_paths::resolve_under_workspace(&base_path, sub_path)?
    };
    if !full_start.is_dir() {
        return Err("path must be a directory".to_string());
    }
    let base_canon = base_path
        .canonicalize()
        .map_err(|e| format!("workspace: {e}"))?;

    let glob_matcher = if let Some(ref g) = glob {
        if g.is_empty() {
            None
        } else {
            let gg = Glob::new(g).map_err(|e| format!("invalid glob: {e}"))?;
            Some(gg.compile_matcher())
        }
    } else {
        None
    };

    tauri::async_runtime::spawn_blocking(move || {
        run_workspace_grep_sync(
            &re,
            base_canon,
            full_start,
            glob_matcher,
            max_m,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
