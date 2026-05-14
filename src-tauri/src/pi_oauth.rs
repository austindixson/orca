//! Pi Mono–compatible OAuth: refresh + read `~/.pi/agent/auth.json` for the same provider IDs as
//! [pi-mono `packages/ai/src/utils/oauth/index.ts](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/oauth/index.ts)`.
//!
//! OAuth **login** can also be started from Orca (`pi_oauth_login`); this module keeps tokens fresh and resolves bearer strings
//! for Orca’s `resolve_llm_api_key` where applicable.

use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};

// --- Anthropic (Claude Pro/Max) — packages/ai/src/utils/oauth/anthropic.ts
pub const PI_KEY_ANTHROPIC: &str = "anthropic";
const ANTHROPIC_OAUTH_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";

// --- OpenAI Codex (ChatGPT) — packages/ai/src/utils/oauth/openai-codex.ts
pub const PI_KEY_OPENAI_CODEX: &str = "openai-codex";
const OPENAI_CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_CODEX_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";

// --- GitHub Copilot — packages/ai/src/utils/oauth/github-copilot.ts
pub const PI_KEY_GITHUB_COPILOT: &str = "github-copilot";

// --- Google Gemini CLI — packages/ai/src/utils/oauth/google-gemini-cli.ts
pub const PI_KEY_GOOGLE_GEMINI_CLI: &str = "google-gemini-cli";
const GEMINI_CLI_CLIENT_ID: &str =
    "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLI_CLIENT_SECRET: &str = "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";

// --- Google Antigravity — packages/ai/src/utils/oauth/google-antigravity.ts
pub const PI_KEY_GOOGLE_ANTIGRAVITY: &str = "google-antigravity";
const ANTIGRAVITY_CLIENT_ID: &str =
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_CLIENT_SECRET: &str = "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";

const GOOGLE_OAUTH_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub fn pi_agent_auth_path() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    Some(home.join(".pi").join("agent").join("auth.json"))
}

pub fn read_pi_auth_json() -> Option<Value> {
    let path = pi_agent_auth_path()?;
    let data = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&data).ok()
}

fn write_json_file_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::fs::OpenOptions;
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = OpenOptions::new()
            .write(true)
            .truncate(true)
            .create(true)
            .mode(0o600)
            .open(path)?;
        f.write_all(bytes)?;
        return Ok(());
    }
    #[cfg(not(unix))]
    {
        fs::write(path, bytes)
    }
}

/// Merge one top-level key into `auth.json` and write with 0600 (Unix).
pub fn merge_pi_auth_json_key(path: &Path, key: &str, entry: Value) -> std::io::Result<()> {
    let mut root = read_pi_auth_json().unwrap_or_else(|| json!({}));
    let obj = root.as_object_mut().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "auth.json root must be an object")
    })?;
    obj.insert(key.to_string(), entry);
    let pretty = serde_json::to_vec_pretty(&root)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    write_json_file_private(path, &pretty)
}

/// Pi-style `key` field for `type: api_key` entries.
pub fn resolve_pi_api_key_field(key: &str) -> Option<String> {
    let k = key.trim();
    if k.is_empty() || k.starts_with('!') {
        return None;
    }
    if k.starts_with("sk-") {
        return Some(k.to_string());
    }
    if let Ok(v) = std::env::var(k) {
        let t = v.trim();
        if !t.is_empty() {
            return Some(t.to_string());
        }
    }
    Some(k.to_string())
}

fn oauth_entry_valid(access: &str, refresh: Option<&str>, expires: i64) -> bool {
    !access.is_empty() && refresh.is_some() && expires > 0 && now_ms() < expires
}

// --- Anthropic refresh (JSON body) ---
fn refresh_anthropic_oauth(refresh_token: &str) -> Option<(String, String, i64)> {
    let body = json!({
        "grant_type": "refresh_token",
        "client_id": ANTHROPIC_OAUTH_CLIENT_ID,
        "refresh_token": refresh_token,
    });
    let resp = ureq::post(ANTHROPIC_TOKEN_URL)
        .set("Content-Type", "application/json")
        .send_json(body)
        .ok()?;
    if resp.status() != 200 {
        return None;
    }
    let v: Value = resp.into_json().ok()?;
    let access = v.get("access_token")?.as_str()?.to_string();
    let refresh = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    let expires_in = v.get("expires_in")?.as_u64()?;
    let expires = now_ms() + (expires_in as i64) * 1000 - 5 * 60 * 1000;
    Some((access, refresh, expires))
}

// --- OpenAI Codex refresh (form-urlencoded) ---
fn refresh_openai_codex_oauth(refresh_token: &str) -> Option<(String, String, i64)> {
    let form = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}",
        urlencoding::encode(refresh_token),
        urlencoding::encode(OPENAI_CODEX_CLIENT_ID)
    );
    let resp = ureq::post(OPENAI_CODEX_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&form)
        .ok()?;
    if resp.status() != 200 {
        return None;
    }
    let v: Value = resp.into_json().ok()?;
    let access = v.get("access_token")?.as_str()?.to_string();
    let refresh = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    let expires_in = v.get("expires_in")?.as_u64()?;
    let expires = now_ms() + (expires_in as i64) * 1000 - 5 * 60 * 1000;
    Some((access, refresh, expires))
}

// --- Google OAuth refresh (Gemini CLI & Antigravity share token URL; different client id/secret) ---
fn refresh_google_oauth_pair(
    refresh_token: &str,
    client_id: &str,
    client_secret: &str,
) -> Option<(String, String, i64)> {
    let form = format!(
        "client_id={}&client_secret={}&refresh_token={}&grant_type=refresh_token",
        urlencoding::encode(client_id),
        urlencoding::encode(client_secret),
        urlencoding::encode(refresh_token)
    );
    let resp = ureq::post(GOOGLE_OAUTH_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&form)
        .ok()?;
    if resp.status() != 200 {
        return None;
    }
    let v: Value = resp.into_json().ok()?;
    let access = v.get("access_token")?.as_str()?.to_string();
    let refresh = v
        .get("refresh_token")
        .and_then(|x| x.as_str())
        .unwrap_or(refresh_token)
        .to_string();
    let expires_in = v.get("expires_in")?.as_u64()?;
    let expires = now_ms() + (expires_in as i64) * 1000 - 5 * 60 * 1000;
    Some((access, refresh, expires))
}

// --- GitHub Copilot: GET copilot_internal token with GitHub OAuth access token as Bearer ---
fn github_copilot_token_url(domain: &str) -> String {
    let domain = domain
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = domain.split('/').next().unwrap_or(domain);
    format!("https://api.{}/copilot_internal/v2/token", host)
}

/// Same idea as Pi’s `normalizeDomain` in `github-copilot.ts`.
fn normalize_github_enterprise_domain(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }
    let host = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);
    let host = host.split('/').next().unwrap_or(host).trim();
    if host.is_empty() {
        return None;
    }
    Some(host.to_string())
}

fn refresh_github_copilot_access(
    github_access_token: &str,
    enterprise_domain: Option<&str>,
) -> Option<(String, String, i64)> {
    let domain = enterprise_domain
        .and_then(normalize_github_enterprise_domain)
        .unwrap_or_else(|| "github.com".to_string());
    let url = github_copilot_token_url(&domain);
    let resp = ureq::get(&url)
        .set("Accept", "application/json")
        .set("Authorization", &format!("Bearer {}", github_access_token))
        .set("User-Agent", "GitHubCopilotChat/0.35.0")
        .set("Editor-Version", "vscode/1.107.0")
        .set("Editor-Plugin-Version", "copilot-chat/0.35.0")
        .set("Copilot-Integration-Id", "vscode-chat")
        .call()
        .ok()?;
    if resp.status() != 200 {
        return None;
    }
    let v: Value = resp.into_json().ok()?;
    let token = v.get("token")?.as_str()?.to_string();
    let exp = v.get("expires_at")?;
    let expires_at_sec = exp
        .as_f64()
        .or_else(|| exp.as_u64().map(|u| u as f64))
        .or_else(|| exp.as_i64().map(|i| i as f64))?;
    let expires = (expires_at_sec * 1000.0) as i64 - 5 * 60 * 1000;
    Some((token, github_access_token.to_string(), expires))
}

/// Resolve `openai` from Pi: `openai` api_key entry, then `openai-codex` OAuth (ChatGPT subscription).
pub fn resolve_openai_from_pi_auth_file() -> Option<String> {
    let path = pi_agent_auth_path()?;
    let root = read_pi_auth_json()?;

    if let Some(entry) = root.get("openai").and_then(|e| e.as_object()) {
        if entry.get("type").and_then(|v| v.as_str()) == Some("api_key") {
            let key = entry.get("key")?.as_str()?;
            if let Some(k) = resolve_pi_api_key_field(key) {
                return Some(k);
            }
        }
    }

    let codex = root.get(PI_KEY_OPENAI_CODEX)?.clone();
    let map = codex.as_object()?;
    if map.get("type").and_then(|v| v.as_str()) == Some("api_key") {
        let key = map.get("key")?.as_str()?;
        return resolve_pi_api_key_field(key);
    }

    let access = map.get("access")?.as_str()?;
    let refresh = map.get("refresh").and_then(|v| v.as_str());
    let expires = map.get("expires").and_then(|v| v.as_i64()).unwrap_or(0);

    if oauth_entry_valid(access, refresh, expires) {
        return Some(access.to_string());
    }
    let refresh = refresh?;
    let (new_access, new_refresh, new_expires) = refresh_openai_codex_oauth(refresh)?;
    let mut new_entry = json!({
        "access": new_access,
        "refresh": new_refresh,
        "expires": new_expires,
    });
    if let Some(aid) = map.get("accountId") {
        new_entry
            .as_object_mut()?
            .insert("accountId".to_string(), aid.clone());
    }
    let _ = merge_pi_auth_json_key(&path, PI_KEY_OPENAI_CODEX, new_entry);
    Some(new_access)
}

/// Resolve only `openai-codex` OAuth/API-key entry from Pi auth (no fallback to plain `openai` API key).
pub fn resolve_openai_codex_from_pi_auth_file() -> Option<String> {
    let path = pi_agent_auth_path()?;
    let root = read_pi_auth_json()?;
    let codex = root.get(PI_KEY_OPENAI_CODEX)?.clone();
    let map = codex.as_object()?;
    if map.get("type").and_then(|v| v.as_str()) == Some("api_key") {
        let key = map.get("key")?.as_str()?;
        return resolve_pi_api_key_field(key);
    }

    let access = map.get("access")?.as_str()?;
    let refresh = map.get("refresh").and_then(|v| v.as_str());
    let expires = map.get("expires").and_then(|v| v.as_i64()).unwrap_or(0);

    if oauth_entry_valid(access, refresh, expires) {
        return Some(access.to_string());
    }
    let refresh = refresh?;
    let (new_access, new_refresh, new_expires) = refresh_openai_codex_oauth(refresh)?;
    let mut new_entry = json!({
        "access": new_access,
        "refresh": new_refresh,
        "expires": new_expires,
    });
    if let Some(aid) = map.get("accountId") {
        new_entry
            .as_object_mut()?
            .insert("accountId".to_string(), aid.clone());
    }
    let _ = merge_pi_auth_json_key(&path, PI_KEY_OPENAI_CODEX, new_entry);
    Some(new_access)
}

/// Anthropic: api_key or OAuth (same as before, now via pi_oauth).
pub fn resolve_anthropic_from_pi_auth_file() -> Option<String> {
    let path = pi_agent_auth_path()?;
    let root = read_pi_auth_json()?;
    let entry = root.get(PI_KEY_ANTHROPIC)?.clone();
    let map = entry.as_object()?;

    if map.get("type").and_then(|v| v.as_str()) == Some("api_key") {
        let key = map.get("key")?.as_str()?;
        return resolve_pi_api_key_field(key);
    }

    let access = map.get("access")?.as_str()?;
    let refresh = map.get("refresh").and_then(|v| v.as_str());
    let expires = map.get("expires").and_then(|v| v.as_i64()).unwrap_or(0);

    if expires > 0 && now_ms() < expires {
        return Some(access.to_string());
    }
    let refresh = refresh?;
    let (new_access, new_refresh, new_expires) = refresh_anthropic_oauth(refresh)?;
    let new_entry = json!({
        "access": new_access,
        "refresh": new_refresh,
        "expires": new_expires,
    });
    let _ = merge_pi_auth_json_key(&path, PI_KEY_ANTHROPIC, new_entry);
    Some(new_access)
}

/// GitHub Copilot JWT for Copilot HTTP APIs (not an Orca chat provider yet; exposed for tooling).
pub fn resolve_github_copilot_from_pi_auth_file() -> Option<String> {
    let path = pi_agent_auth_path()?;
    let root = read_pi_auth_json()?;
    let entry = root.get(PI_KEY_GITHUB_COPILOT)?.clone();
    let map = entry.as_object()?;

    let enterprise = map
        .get("enterpriseUrl")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let access = map.get("access")?.as_str()?;
    let refresh = map.get("refresh")?.as_str()?;
    let expires = map.get("expires").and_then(|v| v.as_i64()).unwrap_or(0);

    if expires > 0 && now_ms() < expires {
        return Some(access.to_string());
    }

    let (new_access, new_refresh, new_expires) =
        refresh_github_copilot_access(refresh, enterprise.as_deref())?;
    let mut new_entry = json!({
        "access": new_access,
        "refresh": new_refresh,
        "expires": new_expires,
    });
    if let Some(e) = enterprise.as_ref() {
        new_entry
            .as_object_mut()?
            .insert("enterpriseUrl".to_string(), json!(e));
    }
    let _ = merge_pi_auth_json_key(&path, PI_KEY_GITHUB_COPILOT, new_entry);
    Some(new_access)
}

/// Refresh stale `google-gemini-cli` / `google-antigravity` entries so Pi CLI keeps working.
/// Does not return a key for Orca `google` (Gemini API key); call when resolving Google or on demand.
pub fn maintain_google_pi_oauth_entries() {
    let Some(path) = pi_agent_auth_path() else {
        return;
    };
    let Some(mut root) = read_pi_auth_json() else {
        return;
    };
    let Some(obj) = root.as_object_mut() else {
        return;
    };

    let mut changed = false;

    if let Some(entry) = obj.get(PI_KEY_GOOGLE_GEMINI_CLI).cloned() {
        if let Some(new_e) = refresh_google_entry_if_stale(
            &entry,
            GEMINI_CLI_CLIENT_ID,
            GEMINI_CLI_CLIENT_SECRET,
        ) {
            obj.insert(PI_KEY_GOOGLE_GEMINI_CLI.to_string(), new_e);
            changed = true;
        }
    }

    if let Some(entry) = obj.get(PI_KEY_GOOGLE_ANTIGRAVITY).cloned() {
        if let Some(new_e) = refresh_google_entry_if_stale(
            &entry,
            ANTIGRAVITY_CLIENT_ID,
            ANTIGRAVITY_CLIENT_SECRET,
        ) {
            obj.insert(PI_KEY_GOOGLE_ANTIGRAVITY.to_string(), new_e);
            changed = true;
        }
    }

    if changed {
        if let Ok(pretty) = serde_json::to_vec_pretty(&root) {
            let _ = write_json_file_private(&path, &pretty);
        }
    }
}

fn refresh_google_entry_if_stale(
    entry: &Value,
    client_id: &str,
    client_secret: &str,
) -> Option<Value> {
    let map = entry.as_object()?;
    if map.get("type").and_then(|v| v.as_str()) == Some("api_key") {
        return None;
    }
    let refresh = map.get("refresh")?.as_str()?;
    let expires = map.get("expires").and_then(|v| v.as_i64()).unwrap_or(0);
    map.get("access")?.as_str()?;
    if expires > 0 && now_ms() < expires {
        return None;
    }
    let project_id = map
        .get("projectId")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let (new_access, new_refresh, new_expires) =
        refresh_google_oauth_pair(refresh, client_id, client_secret)?;
    let mut out = json!({
        "access": new_access,
        "refresh": new_refresh,
        "expires": new_expires,
    });
    let o = out.as_object_mut()?;
    if let Some(pid) = project_id {
        o.insert("projectId".to_string(), json!(pid));
    }
    if let Some(email) = map.get("email") {
        o.insert("email".to_string(), email.clone());
    }
    Some(out)
}

/// `google` in auth.json: plain api_key only (GEMINI-style). OAuth entries use separate Pi keys.
pub fn resolve_google_api_key_from_pi_auth_file() -> Option<String> {
    maintain_google_pi_oauth_entries();
    let root = read_pi_auth_json()?;
    let entry = root.get("google")?.clone();
    let map = entry.as_object()?;
    if map.get("type").and_then(|v| v.as_str()) != Some("api_key") {
        return None;
    }
    let key = map.get("key")?.as_str()?;
    resolve_pi_api_key_field(key)
}

/// Which Pi OAuth keys exist in `auth.json` (after optional maintenance), for Settings / diagnostics.
#[derive(serde::Serialize)]
pub struct PiRegistryKeyStatus {
    pub key: String,
    pub present: bool,
}

pub fn pi_oauth_registry_status() -> Vec<PiRegistryKeyStatus> {
    let root = read_pi_auth_json().unwrap_or(json!({}));
    let keys = [
        PI_KEY_ANTHROPIC,
        "openai",
        PI_KEY_OPENAI_CODEX,
        PI_KEY_GITHUB_COPILOT,
        PI_KEY_GOOGLE_GEMINI_CLI,
        PI_KEY_GOOGLE_ANTIGRAVITY,
        "google",
    ];
    keys.iter()
        .map(|k| PiRegistryKeyStatus {
            key: (*k).to_string(),
            present: root.get(*k).is_some(),
        })
        .collect()
}
