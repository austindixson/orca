//! Resolve LLM API keys the same way as Hermes Agent / OpenClaw: standard env vars plus
//! `~/.hermes/.env` and `~/.openclaw/.env` (same filenames and variable names).
//!
//! Pi Mono’s provider registry (`packages/ai/src/utils/oauth/index.ts`) is implemented in
//! [`crate::pi_oauth`]. For the same keys as Pi, `~/.pi/agent/auth.json` is consulted before env.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

fn home_env_files() -> Vec<PathBuf> {
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    vec![
        home.join(".hermes").join(".env"),
        home.join(".openclaw").join(".env"),
        home.join(".agent-canvas").join(".env"),
    ]
}

fn parse_dotenv(content: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim();
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim().to_string();
        let mut val = v.trim().to_string();
        if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\''))
        {
            val = val[1..val.len().saturating_sub(1)].to_string();
        }
        map.insert(key, val);
    }
    map
}

fn first_from_process_env(keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Ok(v) = std::env::var(k) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

fn first_from_map(map: &HashMap<String, String>, keys: &[&str]) -> Option<String> {
    for k in keys {
        if let Some(v) = map.get(*k) {
            let t = v.trim();
            if !t.is_empty() {
                return Some(v.clone());
            }
        }
    }
    None
}

/// Process env first, then each dotenv file in order (Hermes → OpenClaw → agent-canvas).
fn resolve_from_env_files(keys: &[&str]) -> Option<String> {
    if let Some(v) = first_from_process_env(keys) {
        return Some(v);
    }
    for path in home_env_files() {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let map = parse_dotenv(&content);
        if let Some(v) = first_from_map(&map, keys) {
            return Some(v);
        }
    }
    None
}

/// Z.AI Coding Plan API base — keep in sync with `ZAI_DEFAULT_BASE` in `packages/client/src/store/settingsStore.ts`.
const ZAI_DEFAULT_CODING_BASE: &str = "https://api.z.ai/api/coding/paas/v4";

/// Hermes HTTP gateway: `API_SERVER_KEY` in process env or `~/.hermes/.env` only (same file Hermes reads).
pub fn resolve_hermes_api_server_key() -> Option<String> {
    if let Some(v) = first_from_process_env(&["API_SERVER_KEY"]) {
        return Some(v);
    }
    let Some(home) = dirs::home_dir() else {
        return None;
    };
    let path = home.join(".hermes").join(".env");
    let Ok(content) = fs::read_to_string(&path) else {
        return None;
    };
    let map = parse_dotenv(&content);
    first_from_map(&map, &["API_SERVER_KEY"])
}

/// Pi `auth.json` first (same provider IDs as Pi), then Hermes/OpenClaw env files.
pub fn resolve_provider_api_key(provider: &str) -> Option<String> {
    match provider {
        "openai" => crate::pi_oauth::resolve_openai_from_pi_auth_file()
            .or_else(|| resolve_from_env_files(&["OPENAI_API_KEY"])),
        "openai-codex" => crate::pi_oauth::resolve_openai_codex_from_pi_auth_file(),
        "anthropic" => crate::pi_oauth::resolve_anthropic_from_pi_auth_file().or_else(|| {
            resolve_from_env_files(&["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"])
        }),
        "google" => crate::pi_oauth::resolve_google_api_key_from_pi_auth_file().or_else(|| {
            // Pi `env-api-keys.ts` maps `google` → GEMINI_API_KEY
            resolve_from_env_files(&["GEMINI_API_KEY", "GOOGLE_API_KEY"])
        }),
        "github-copilot" => crate::pi_oauth::resolve_github_copilot_from_pi_auth_file().or_else(|| {
            // Pi `env-api-keys.ts` for github-copilot
            resolve_from_env_files(&["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"])
        }),
        "openrouter" => resolve_from_env_files(&["OPENROUTER_API_KEY"]),
        "zai" => resolve_from_env_files(&["ZAI_API_KEY", "GLM_API_KEY", "ZHIPU_API_KEY"]),
        "mistral" => resolve_from_env_files(&["MISTRAL_API_KEY"]),
        "azure-openai-responses" => resolve_from_env_files(&["AZURE_OPENAI_API_KEY"]),
        "google-vertex" => resolve_from_env_files(&["GOOGLE_CLOUD_ACCESS_TOKEN", "GOOGLE_API_KEY"]),
        "bedrock" => resolve_from_env_files(&["AWS_ACCESS_KEY_ID"]),
        "ollama" => None,
        _ => None,
    }
}

/// Optional base URL overrides (same env names as common tooling).
pub fn resolve_provider_base_url(provider: &str) -> Option<String> {
    if provider == "zai" {
        let raw = resolve_from_env_files(&[
            "ZAI_CODING_BASE_URL",
            "ZAI_BASE_URL",
            "GLM_BASE_URL",
            "ZHIPU_BASE_URL",
        ]);
        let s = match raw {
            Some(r) if !r.trim().is_empty() => r,
            _ => ZAI_DEFAULT_CODING_BASE.to_string(),
        };
        return Some(normalize_base_url("zai", &s));
    }
    let raw = match provider {
        "openai" => resolve_from_env_files(&["OPENAI_BASE_URL"]),
        "anthropic" => resolve_from_env_files(&["ANTHROPIC_BASE_URL"]),
        "google" => resolve_from_env_files(&["GOOGLE_GENAI_BASE_URL", "GEMINI_BASE_URL"]),
        "openrouter" => resolve_from_env_files(&["OPENROUTER_BASE_URL"]),
        "ollama" => resolve_from_env_files(&["OLLAMA_HOST", "OLLAMA_BASE_URL"]),
        "mistral" => resolve_from_env_files(&["MISTRAL_BASE_URL"]),
        "azure-openai-responses" => resolve_from_env_files(&["AZURE_OPENAI_ENDPOINT"]),
        "github-copilot" => resolve_from_env_files(&["GITHUB_COPILOT_HOST"]),
        "google-vertex" => resolve_from_env_files(&["VERTEX_AI_BASE_URL", "GOOGLE_VERTEX_BASE_URL"]),
        "bedrock" => resolve_from_env_files(&["AWS_REGION"]),
        _ => None,
    }?;
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    Some(normalize_base_url(provider, t))
}

fn normalize_base_url(provider: &str, s: &str) -> String {
    let s = s.trim_end_matches('/');
    if provider == "ollama" && !s.contains("://") {
        return format!("http://{}", s);
    }
    if provider == "zai" {
        return normalize_zai_base_url(s);
    }
    s.to_string()
}

/// Align with Orca client: Coding Plan quota uses `…/api/coding/paas/v4`, not general `…/api/paas/v4`.
fn normalize_zai_base_url(s: &str) -> String {
    let lower = s.to_lowercase();
    if lower == "https://api.z.ai/api/paas/v4" || lower == "http://api.z.ai/api/paas/v4" {
        return "https://api.z.ai/api/coding/paas/v4".to_string();
    }
    s.to_string()
}
