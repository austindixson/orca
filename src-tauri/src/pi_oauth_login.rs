//! Interactive OAuth login (Pi-compatible): opens the system browser, receives localhost callbacks,
//! writes tokens to `~/.pi/agent/auth.json`. Matches flows in pi-mono
//! [`anthropic.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/oauth/anthropic.ts),
//! [`openai-codex.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/oauth/openai-codex.ts),
//! [`google-gemini-cli.ts`](https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/oauth/google-gemini-cli.ts).
//!
//! **Note:** Claude and ChatGPT (Codex) use **Anthropic** and **OpenAI** OAuth — not “Sign in with Google”.
//! **Google** OAuth applies to **Gemini CLI / Cloud Code Assist** only, per
//! [Pi providers](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md#subscriptions).

use base64::Engine;
use rand::Rng;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant};

use crate::pi_oauth::{
    merge_pi_auth_json_key, pi_agent_auth_path, PI_KEY_ANTHROPIC, PI_KEY_GOOGLE_GEMINI_CLI,
    PI_KEY_OPENAI_CODEX,
};

// --- Anthropic (claude.ai / platform.claude.com) ---
const ANTHROPIC_CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const ANTHROPIC_AUTH_URL: &str = "https://claude.ai/oauth/authorize";
const ANTHROPIC_TOKEN_URL: &str = "https://platform.claude.com/v1/oauth/token";
const ANTHROPIC_CALLBACK_PORT: u16 = 53692;
const ANTHROPIC_CALLBACK_PATH: &str = "/callback";
/// Must match Anthropic's registered redirect exactly. Use `localhost`, not `127.0.0.1`
/// (see pi-mono `anthropic.ts`); mismatches cause "Redirect URI is not supported by client".
const ANTHROPIC_REDIRECT_HOST: &str = "localhost";
const ANTHROPIC_SCOPES: &str = "org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

// --- OpenAI Codex ---
const OPENAI_CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const OPENAI_AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CALLBACK_PORT: u16 = 1455;
const OPENAI_CALLBACK_PATH: &str = "/auth/callback";
/// Prefer the canonical localhost callback instead of hard-coding 127.0.0.1.
/// Some OAuth apps validate the registered loopback host strictly.
const OPENAI_REDIRECT_HOST: &str = "localhost";
const OPENAI_SCOPE: &str = "openid profile email offline_access";
const JWT_CLAIM_OPENAI: &str = "https://api.openai.com/auth";

// --- Google Gemini CLI (Cloud Code Assist) ---
const GEMINI_CLI_CLIENT_ID: &str =
    "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";
const GEMINI_CLI_CLIENT_SECRET: &str = "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";
const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_CALLBACK_PORT: u16 = 8085;
const GOOGLE_REDIRECT_URI: &str = "http://localhost:8085/oauth2callback";
const GOOGLE_CALLBACK_PATH: &str = "/oauth2callback";
const GOOGLE_SCOPES: &[&str] = &[
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
];
const CODE_ASSIST: &str = "https://cloudcode-pa.googleapis.com";

fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

fn pkce_verifier() -> String {
    let mut rng = rand::thread_rng();
    let mut b = [0u8; 32];
    rng.fill(&mut b);
    b64url(&b)
}

fn pkce_challenge_s256(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    b64url(h.finalize().as_slice())
}

fn oauth_success_html(title: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title></head>
<body style="font-family:system-ui;padding:2rem"><p>{title}</p><p>You can close this tab.</p></body></html>"#
    )
}

fn oauth_error_html(msg: &str) -> String {
    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:system-ui;padding:2rem"><p>OAuth error</p><p>{msg}</p></body></html>"#
    )
}

fn parse_http_first_request(stream: &mut TcpStream) -> std::io::Result<(String, HashMap<String, String>)> {
    let mut buf = [0u8; 16384];
    let n = stream.read(&mut buf)?;
    let req = std::str::from_utf8(&buf[..n]).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "non-utf8 request")
    })?;
    let line = req.lines().next().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "empty request")
    })?;
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 2 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            "bad request line",
        ));
    }
    let path_query = parts[1];
    let path_only = path_query
        .split('?')
        .next()
        .unwrap_or(path_query)
        .to_string();
    let query = path_query.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut params = HashMap::new();
    for pair in query.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        let key = urlencoding::decode(k).map(|c| c.into_owned()).unwrap_or_else(|_| k.to_string());
        let val = urlencoding::decode(v).map(|c| c.into_owned()).unwrap_or_else(|_| v.to_string());
        params.insert(key, val);
    }
    Ok((path_only, params))
}

fn bind_localhost_oauth(port: u16) -> Result<Vec<TcpListener>, String> {
    let addrs = [format!("127.0.0.1:{port}"), format!("[::1]:{port}")];
    let mut listeners = Vec::new();
    let mut errors = Vec::new();

    for addr in addrs {
        match TcpListener::bind(&addr) {
            Ok(listener) => listeners.push(listener),
            Err(e) => errors.push(format!("{addr} ({e})")),
        }
    }

    if listeners.is_empty() {
        return Err(format!(
            "Could not bind loopback OAuth callback on port {port}. Tried: {}. Close apps using this port or retry after stopping Pi OAuth.",
            errors.join(", ")
        ));
    }

    Ok(listeners)
}

/// Must bind **before** opening the browser so the redirect is never missed.
fn wait_oauth_on_listener(
    listeners: Vec<TcpListener>,
    expected_path: &str,
    deadline: Duration,
) -> Result<HashMap<String, String>, String> {
    for listener in &listeners {
        listener.set_nonblocking(true).ok();
    }
    let start = Instant::now();
    loop {
        if start.elapsed() > deadline {
            return Err("OAuth timed out waiting for browser redirect.".into());
        }
        for listener in &listeners {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream
                        .set_read_timeout(Some(Duration::from_secs(30)))
                        .ok();
                    let (path, params) = parse_http_first_request(&mut stream)
                        .map_err(|e| format!("Bad OAuth callback request: {e}"))?;
                    if path != expected_path {
                        let body = oauth_error_html("wrong callback path");
                        let resp = format!(
                            "HTTP/1.1 404 Not Found\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        return Err(format!("Unexpected callback path: {path}"));
                    }
                    if let Some(err) = params.get("error") {
                        let body = oauth_error_html(err);
                        let resp = format!(
                            "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = stream.write_all(resp.as_bytes());
                        return Err(format!("OAuth provider error: {err}"));
                    }
                    let body = oauth_success_html("Signed in successfully.");
                    let resp = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.write_all(resp.as_bytes());
                    return Ok(params);
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(e) => return Err(format!("accept failed: {e}")),
            }
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn open_browser(url: &str) -> Result<(), String> {
    open::that(url).map_err(|e| format!("Could not open browser: {e}"))
}

// --- Anthropic ---

pub fn login_anthropic_oauth() -> Result<(), String> {
    let path = pi_agent_auth_path().ok_or_else(|| "Could not resolve home directory.".to_string())?;
    let listeners = bind_localhost_oauth(ANTHROPIC_CALLBACK_PORT)?;
    let verifier = pkce_verifier();
    let challenge = pkce_challenge_s256(&verifier);
    let redirect_uri = format!(
        "http://{ANTHROPIC_REDIRECT_HOST}:{ANTHROPIC_CALLBACK_PORT}{ANTHROPIC_CALLBACK_PATH}"
    );

    let mut auth = url::Url::parse(ANTHROPIC_AUTH_URL).map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("code", "true")
        .append_pair("client_id", ANTHROPIC_CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", ANTHROPIC_SCOPES)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &verifier);

    open_browser(auth.as_str())?;

    let params = wait_oauth_on_listener(listeners, ANTHROPIC_CALLBACK_PATH, Duration::from_secs(600))?;
    let code = params.get("code").ok_or_else(|| "Missing code".to_string())?;
    let state = params.get("state").ok_or_else(|| "Missing state".to_string())?;
    if state != &verifier {
        return Err("OAuth state mismatch.".into());
    }

    let body = json!({
        "grant_type": "authorization_code",
        "client_id": ANTHROPIC_CLIENT_ID,
        "code": code,
        "state": state,
        "redirect_uri": redirect_uri,
        "code_verifier": verifier,
    });

    let resp = ureq::post(ANTHROPIC_TOKEN_URL)
        .set("Content-Type", "application/json")
        .set("Accept", "application/json")
        .send_json(body)
        .map_err(|e| format!("Token exchange failed: {e}"))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(format!("Anthropic token error HTTP {status}: {text}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let access = v["access_token"].as_str().ok_or("no access_token")?;
    let refresh = v["refresh_token"].as_str().ok_or("no refresh_token")?;
    let expires_in = v["expires_in"].as_u64().ok_or("no expires_in")?;
    let expires = crate::pi_oauth::now_ms() + (expires_in as i64) * 1000 - 5 * 60 * 1000;

    let entry = json!({
        "access": access,
        "refresh": refresh,
        "expires": expires,
    });
    merge_pi_auth_json_key(&path, PI_KEY_ANTHROPIC, entry).map_err(|e| e.to_string())?;
    Ok(())
}

// --- OpenAI Codex ---

fn random_hex_32() -> String {
    let mut b = [0u8; 16];
    rand::thread_rng().fill(&mut b);
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn b64url_pad_segment(seg: &str) -> String {
    let mut s = seg.replace('-', "+").replace('_', "/");
    match s.len() % 4 {
        2 => s.push_str("=="),
        3 => s.push('='),
        _ => {}
    }
    s
}

fn openai_account_id_from_access(access: &str) -> Option<String> {
    let parts: Vec<&str> = access.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let padded = b64url_pad_segment(parts[1]);
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(padded.as_bytes())
        .ok()?;
    let val: Value = serde_json::from_slice(&decoded).ok()?;
    val.get(JWT_CLAIM_OPENAI)?
        .get("chatgpt_account_id")?
        .as_str()
        .map(|s| s.to_string())
}

pub fn login_openai_codex_oauth() -> Result<(), String> {
    let path = pi_agent_auth_path().ok_or_else(|| "Could not resolve home directory.".to_string())?;
    let listeners = bind_localhost_oauth(OPENAI_CALLBACK_PORT)?;
    let verifier = pkce_verifier();
    let challenge = pkce_challenge_s256(&verifier);
    let state = random_hex_32();
    let redirect_uri = format!("http://{OPENAI_REDIRECT_HOST}:{OPENAI_CALLBACK_PORT}{OPENAI_CALLBACK_PATH}");

    let mut auth = url::Url::parse(OPENAI_AUTH_URL).map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", OPENAI_CODEX_CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", OPENAI_SCOPE)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &state)
        .append_pair("id_token_add_organizations", "true")
        .append_pair("codex_cli_simplified_flow", "true")
        .append_pair("originator", "orca");

    open_browser(auth.as_str())?;

    let params = wait_oauth_on_listener(listeners, OPENAI_CALLBACK_PATH, Duration::from_secs(600))?;
    if params.get("state").map(|s| s.as_str()) != Some(&state) {
        return Err("OAuth state mismatch.".into());
    }
    let code = params.get("code").ok_or_else(|| "Missing code".to_string())?;

    let form = format!(
        "grant_type=authorization_code&client_id={}&code={}&code_verifier={}&redirect_uri={}",
        urlencoding::encode(OPENAI_CODEX_CLIENT_ID),
        urlencoding::encode(code),
        urlencoding::encode(&verifier),
        urlencoding::encode(&redirect_uri),
    );
    let resp = ureq::post(OPENAI_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&form)
        .map_err(|e| format!("Token exchange failed: {e}"))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(format!("OpenAI token error HTTP {status}: {text}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let access = v["access_token"].as_str().ok_or("no access_token")?.to_string();
    let refresh = v["refresh_token"].as_str().ok_or("no refresh_token")?.to_string();
    let expires_in = v["expires_in"].as_u64().ok_or("no expires_in")?;
    let expires = crate::pi_oauth::now_ms() + (expires_in as i64) * 1000 - 5 * 60 * 1000;

    let account_id = openai_account_id_from_access(&access)
        .ok_or_else(|| "Could not read ChatGPT account id from token. Try again or use Pi CLI.".to_string())?;

    let entry = json!({
        "access": access,
        "refresh": refresh,
        "expires": expires,
        "accountId": account_id,
    });
    merge_pi_auth_json_key(&path, PI_KEY_OPENAI_CODEX, entry).map_err(|e| e.to_string())?;
    Ok(())
}

// --- Google Gemini CLI ---

fn google_user_email(access: &str) -> Option<String> {
    let resp = ureq::get("https://www.googleapis.com/oauth2/v1/userinfo?alt=json")
        .set("Authorization", &format!("Bearer {access}"))
        .call()
        .ok()?;
    if resp.status() != 200 {
        return None;
    }
    let text = resp.into_string().ok()?;
    let v: Value = serde_json::from_str(&text).ok()?;
    v.get("email")?.as_str().map(|s| s.to_string())
}

fn cloud_project_id_from_load_payload(data: &Value) -> Option<String> {
    if let Some(s) = data.get("cloudaicompanionProject").and_then(|x| x.as_str()) {
        if !s.is_empty() {
            return Some(s.to_string());
        }
    }
    data.get("cloudaicompanionProject")?
        .get("id")?
        .as_str()
        .map(|s| s.to_string())
}

/// Best-effort Cloud Code Assist project discovery (Pi `discoverProject` subset).
fn discover_gemini_project_id(access: &str) -> Result<String, String> {
    let env_project = std::env::var("GOOGLE_CLOUD_PROJECT")
        .or_else(|_| std::env::var("GOOGLE_CLOUD_PROJECT_ID"))
        .ok();

    let body = json!({
        "metadata": {
            "ideType": "IDE_UNSPECIFIED",
            "platform": "PLATFORM_UNSPECIFIED",
            "pluginType": "GEMINI",
            "duetProject": env_project.clone(),
        },
        "cloudaicompanionProject": env_project.clone(),
    });

    let load = ureq::post(&format!("{CODE_ASSIST}/v1internal:loadCodeAssist"))
        .set("Authorization", &format!("Bearer {access}"))
        .set("Content-Type", "application/json")
        .set("User-Agent", "google-api-nodejs-client/9.15.1")
        .send_json(body);

    let load = match load {
        Ok(r) => r,
        Err(e) => return Err(format!("loadCodeAssist request failed: {e}")),
    };

    let st = load.status();
    if st < 200 || st >= 300 {
        let t = load.into_string().unwrap_or_default();
        if let Some(pid) = env_project {
            return Ok(pid);
        }
        return Err(format!(
            "loadCodeAssist failed (HTTP). Set GOOGLE_CLOUD_PROJECT and retry. Details: {t}"
        ));
    }

    let text = load.into_string().map_err(|e| e.to_string())?;
    let data: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;

    if let Some(pid) = cloud_project_id_from_load_payload(&data) {
        if !pid.is_empty() {
            return Ok(pid);
        }
    }

    if let Some(pid) = env_project {
        return Ok(pid);
    }

    Err(
        "Could not discover a Google Cloud project. Set GOOGLE_CLOUD_PROJECT (see Pi Gemini CLI docs) and retry."
            .into(),
    )
}

pub fn login_google_gemini_cli_oauth() -> Result<(), String> {
    let path = pi_agent_auth_path().ok_or_else(|| "Could not resolve home directory.".to_string())?;
    let listeners = bind_localhost_oauth(GOOGLE_CALLBACK_PORT)?;
    let verifier = pkce_verifier();
    let challenge = pkce_challenge_s256(&verifier);

    let scope = GOOGLE_SCOPES.join(" ");
    let mut auth = url::Url::parse(GOOGLE_AUTH_URL).map_err(|e| e.to_string())?;
    auth.query_pairs_mut()
        .append_pair("client_id", GEMINI_CLI_CLIENT_ID)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", GOOGLE_REDIRECT_URI)
        .append_pair("scope", &scope)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &verifier)
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent");

    open_browser(auth.as_str())?;

    let params = wait_oauth_on_listener(listeners, GOOGLE_CALLBACK_PATH, Duration::from_secs(600))?;
    if params.get("state").map(|s| s.as_str()) != Some(verifier.as_str()) {
        return Err("OAuth state mismatch.".into());
    }
    let code = params.get("code").ok_or_else(|| "Missing code".to_string())?;

    let form = format!(
        "client_id={}&client_secret={}&code={}&grant_type=authorization_code&redirect_uri={}&code_verifier={}",
        urlencoding::encode(GEMINI_CLI_CLIENT_ID),
        urlencoding::encode(GEMINI_CLI_CLIENT_SECRET),
        urlencoding::encode(code),
        urlencoding::encode(GOOGLE_REDIRECT_URI),
        urlencoding::encode(&verifier),
    );
    let resp = ureq::post(GOOGLE_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&form)
        .map_err(|e| format!("Token exchange failed: {e}"))?;
    let status = resp.status();
    let text = resp.into_string().map_err(|e| e.to_string())?;
    if status != 200 {
        return Err(format!("Google token error HTTP {status}: {text}"));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let access = v["access_token"].as_str().ok_or("no access_token")?.to_string();
    let refresh = v["refresh_token"].as_str().ok_or("no refresh_token")?.to_string();
    let expires_in = v["expires_in"].as_u64().ok_or("no expires_in")?;
    let expires = crate::pi_oauth::now_ms() + (expires_in as i64) * 1000 - 5 * 60 * 1000;

    let email = google_user_email(&access);
    let project_id = discover_gemini_project_id(&access)?;

    let mut entry = json!({
        "access": access,
        "refresh": refresh,
        "expires": expires,
        "projectId": project_id,
    });
    if let Some(e) = email {
        entry
            .as_object_mut()
            .expect("object")
            .insert("email".to_string(), json!(e));
    }

    merge_pi_auth_json_key(&path, PI_KEY_GOOGLE_GEMINI_CLI, entry).map_err(|e| e.to_string())?;
    Ok(())
}
