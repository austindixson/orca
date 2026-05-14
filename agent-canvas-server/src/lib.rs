//! Orca companion server: HTTP + WebSocket (PTY, agents, canvas bridge).
//! Use [`run`] to embed the server; the `agent-canvas-server` binary calls it from `main`.

pub mod agent_manager;
pub mod canvas_bridge;
pub mod native_telegram;
pub mod pty_manager;

use std::collections::HashSet;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use agent_manager::{AgentEvent, AgentManager, AgentJson, AgentType};
use canvas_bridge::CanvasBridge;
use native_telegram::TelegramGateway;
use pty_manager::{PtyEvent, PtyManager};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::header::AUTHORIZATION;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::fs;
use tokio::sync::{mpsc, Mutex};
use tower_http::cors::CorsLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnFailure, DefaultOnResponse, TraceLayer};
use tracing::{info, Level};

const MANIFEST: &str = include_str!("../canvas_tools_manifest.json");

/// Last caller of `POST /api/canvas/execute` that sent `X-Orca-External-Agent` (e.g. `hermes`). Expires after TTL.
#[derive(Clone)]
pub struct AppState {
    pub workspace: Arc<PathBuf>,
    pub bridge_token: Option<String>,
    pub pty: Arc<PtyManager>,
    pub agents: Arc<AgentManager>,
    pub canvas: Arc<CanvasBridge>,
    pub telegram: Arc<TelegramGateway>,
    pub external_orchestrator: Arc<Mutex<Option<(String, u64)>>>,
}

const EXTERNAL_ORCH_TTL_MS: u64 = 120_000;

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn parse_telegram_allowed_user_ids_from_env() -> Option<HashSet<i64>> {
    let raw = std::env::var("ORCA_TELEGRAM_ALLOWED_USER_IDS").ok()?;
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    let set: HashSet<i64> = t
        .split(|c: char| c.is_whitespace() || c == ',')
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .collect();
    if set.is_empty() {
        None
    } else {
        Some(set)
    }
}

async fn autostart_telegram_if_daemon(state: AppState) {
    let token = std::env::var("ORCA_TELEGRAM_BOT_TOKEN")
        .unwrap_or_default()
        .trim()
        .to_string();
    if token.is_empty() {
        info!("[Gateway] daemon autostart skipped — no ORCA_TELEGRAM_BOT_TOKEN");
        return;
    }
    let allowed = parse_telegram_allowed_user_ids_from_env();
    let canvas = Arc::clone(&state.canvas);
    match state.telegram.start(canvas, token, allowed).await {
        Ok(()) => info!("[Gateway] Telegram gateway autostarted (orcad)"),
        Err(e) => tracing::warn!("[Gateway] Telegram autostart failed: {}", e),
    }
}

/// Configuration for [`run`].
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub workspace: PathBuf,
    pub bridge_token: Option<String>,
    pub port: u16,
    /// If true, initialize `tracing_subscriber` (skip when embedded in a process that already logs).
    pub init_tracing: bool,
    /// Set by `orcad` — enables auto-start of the native Telegram gateway when
    /// `ORCA_TELEGRAM_BOT_TOKEN` is present (same behavior as Node telemetry server boot).
    pub supervised_by_daemon: bool,
}

impl ServerConfig {
    /// Load from environment: `WORKSPACE_ROOT`, `CANVAS_BRIDGE_TOKEN`, `PORT` (default 3001).
    pub fn from_env() -> anyhow::Result<Self> {
        let workspace = std::env::var("WORKSPACE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::current_dir().expect("cwd"));
        let bridge_token = std::env::var("CANVAS_BRIDGE_TOKEN").ok();
        let port: u16 = std::env::var("PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3001);
        Ok(Self {
            workspace,
            bridge_token,
            port,
            init_tracing: true,
            supervised_by_daemon: false,
        })
    }
}

/// Run the HTTP + WebSocket server until shutdown (Ctrl+C or process kill).
pub async fn run(config: ServerConfig) -> anyhow::Result<()> {
    if config.init_tracing {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env()
                    .unwrap_or_else(|_| "agent_canvas_server=info,tower_http=info".into()),
            )
            .init();
    }

    let workspace = Arc::new(config.workspace);
    let bridge_token = config.bridge_token;

    let state = AppState {
        workspace,
        bridge_token,
        pty: Arc::new(PtyManager::new()),
        agents: Arc::new(AgentManager::new()),
        canvas: Arc::new(CanvasBridge::new()),
        telegram: Arc::new(TelegramGateway::new()),
        external_orchestrator: Arc::new(Mutex::new(None)),
    };

    if config.supervised_by_daemon {
        let st = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            autostart_telegram_if_daemon(st).await;
        });
    }

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/home-dir", get(api_home_dir))
        .route("/api/canvas/tools", get(|| async { MANIFEST }))
        .route("/api/canvas/bridge-status", get(bridge_status))
        .route("/api/canvas/execute", post(canvas_execute))
        .route("/api/gateway/status", get(gateway_status))
        .route("/api/gateway/telegram/start", post(gateway_telegram_start))
        .route("/api/gateway/telegram/stop", post(gateway_telegram_stop))
        .route("/api/gateway/telegram/bot-info", post(gateway_telegram_bot_info))
        .route("/api/harness/chat", post(harness_chat))
        .route("/api/orchestrator/reply", post(orchestrator_reply))
        .route("/api/files", get(get_files))
        .route("/api/file", get(get_file).post(post_file).delete(delete_file))
        .route("/ws", get(ws_upgrade))
        .layer(CorsLayer::permissive())
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().include_headers(false))
                .on_response(DefaultOnResponse::new().level(Level::INFO))
                .on_failure(DefaultOnFailure::new().level(Level::ERROR)),
        )
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], config.port));
    info!(
        "Orca Coder server (Rust) http://{addr} · ws://{addr}/ws · WORKSPACE_ROOT={}",
        std::env::var("WORKSPACE_ROOT").unwrap_or_else(|_| ".".into())
    );
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "headlessGatewayRegistered": state.canvas.headless_gateway_registered(),
    }))
}

/// User home directory for the Orca UI (browser dev cannot use Tauri `get_home_dir`).
/// Enables slash-menu discovery of `~/.claude/skills`, etc.
async fn api_home_dir() -> Json<Value> {
    let path = dirs::home_dir().map(|p| p.to_string_lossy().to_string());
    Json(json!({ "path": path }))
}

fn canonical_home_dir() -> Option<PathBuf> {
    dirs::home_dir().and_then(|h| h.canonicalize().ok().or(Some(h)))
}

/// Allow reads under the configured workspace **or** under the current user's home (for
/// `~/.cursor/skills`, `~/.claude/skills`, plugin caches). Writes stay workspace-only.
fn resolve_allowed_read_path(
    state: &AppState,
    path_arg: &str,
) -> Result<PathBuf, (axum::http::StatusCode, String)> {
    let workspace = state.workspace.as_ref();
    let p = PathBuf::from(path_arg);
    let candidate = if p.is_absolute() {
        p
    } else {
        workspace.join(path_arg)
    };
    let full = candidate.canonicalize().unwrap_or_else(|_| candidate.clone());
    if full.starts_with(workspace) {
        return Ok(full);
    }
    if let Some(home) = canonical_home_dir() {
        if full.starts_with(&home) {
            return Ok(full);
        }
    }
    Err((axum::http::StatusCode::FORBIDDEN, "path not allowed".into()))
}

async fn bridge_status(State(state): State<AppState>) -> Json<Value> {
    let now = now_ms();
    let ext = {
        let g = state.external_orchestrator.lock().await;
        g.clone()
    };
    let external_orchestrator = match ext {
        Some((id, ts)) if now.saturating_sub(ts) < EXTERNAL_ORCH_TTL_MS => {
            json!({ "id": id, "lastSeenMs": ts })
        }
        _ => Value::Null,
    };

    Json(json!({
        "uiClients": state.canvas.subscriber_count(),
        "tokenRequired": state.bridge_token.is_some(),
        "externalOrchestrator": external_orchestrator,
        "headlessGatewayRegistered": state.canvas.headless_gateway_registered(),
    }))
}

async fn gateway_status(State(state): State<AppState>) -> Json<Value> {
    let running = state.telegram.is_running().await;
    Json(json!({
        "telegram": { "running": running },
        "uiClients": state.canvas.subscriber_count(),
        "headlessGatewayRegistered": state.canvas.headless_gateway_registered(),
    }))
}

#[derive(Deserialize)]
struct CanvasExecuteBody {
    tool: String,
    #[serde(rename = "arguments")]
    args: Option<Value>,
}

async fn canvas_execute(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<CanvasExecuteBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(ref token) = state.bridge_token {
        let ok = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s == format!("Bearer {}", token))
            .unwrap_or(false);
        if !ok {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>" })),
            ));
        }
    }
    if let Some(h) = headers.get("x-orca-external-agent") {
        if let Ok(s) = h.to_str() {
            let id = s.trim().to_lowercase();
            if !id.is_empty() {
                *state.external_orchestrator.lock().await = Some((id, now_ms()));
            }
        }
    }
    let args_json = match body.args {
        Some(v) => serde_json::to_string(&v).unwrap_or_else(|_| "{}".into()),
        None => "{}".into(),
    };
    match state
        .canvas
        .invoke_tool(body.tool, args_json)
        .await
    {
        Ok(result) => Ok(Json(json!({ "ok": true, "result": result }))),
        Err(e) => Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "ok": false, "error": e.to_string() })),
        )),
    }
}

#[derive(Deserialize)]
struct TelegramStartBody {
    #[serde(default)]
    token: String,
    #[serde(rename = "allowedUserIds")]
    allowed_user_ids: Option<Vec<i64>>,
}

async fn gateway_telegram_start(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<TelegramStartBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(ref token) = state.bridge_token {
        let ok = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s == format!("Bearer {}", token))
            .unwrap_or(false);
        if !ok {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>" })),
            ));
        }
    }
    let from_body = body.token.trim();
    let from_env = std::env::var("ORCA_TELEGRAM_BOT_TOKEN")
        .unwrap_or_default()
        .trim()
        .to_string();
    let effective = if from_body.is_empty() {
        from_env
    } else {
        from_body.to_string()
    };
    if effective.is_empty() {
        return Ok(Json(json!({
            "ok": true,
            "skipped": true,
            "telegram": { "running": false },
            "message": "No Telegram bot token — set ORCA_TELEGRAM_BOT_TOKEN on the companion server process, then Start again (optional override: paste token in Orca)."
        })));
    }
    let allowed = body
        .allowed_user_ids
        .filter(|v| !v.is_empty())
        .map(|v| v.into_iter().collect::<HashSet<_>>());

    let canvas = Arc::clone(&state.canvas);
    match state
        .telegram
        .start(canvas, effective, allowed)
        .await
    {
        Ok(()) => Ok(Json(json!({ "ok": true, "telegram": { "running": true } }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": e.to_string() })),
        )),
    }
}

async fn gateway_telegram_stop(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(ref token) = state.bridge_token {
        let ok = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s == format!("Bearer {}", token))
            .unwrap_or(false);
        if !ok {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>" })),
            ));
        }
    }
    match state.telegram.stop().await {
        Ok(()) => Ok(Json(json!({ "ok": true, "telegram": { "running": false } }))),
        Err(e) => Err((
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "ok": false, "error": e.to_string() })),
        )),
    }
}

/// POST body: optional `token` — falls back to `ORCA_TELEGRAM_BOT_TOKEN`. Returns `openUrl` = `https://t.me/<username>` for QR onboarding.
async fn gateway_telegram_bot_info(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<TelegramStartBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(ref token) = state.bridge_token {
        let ok = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s == format!("Bearer {}", token))
            .unwrap_or(false);
        if !ok {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>" })),
            ));
        }
    }
    let from_body = body.token.trim();
    let from_env = std::env::var("ORCA_TELEGRAM_BOT_TOKEN")
        .unwrap_or_default()
        .trim()
        .to_string();
    let effective = if from_body.is_empty() {
        from_env
    } else {
        from_body.to_string()
    };
    if effective.is_empty() {
        return Ok(Json(json!({
            "ok": false,
            "error": "No bot token — paste in Orca or set ORCA_TELEGRAM_BOT_TOKEN on the server."
        })));
    }
    let url = format!("https://api.telegram.org/bot{effective}/getMe");
    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return Ok(Json(json!({ "ok": false, "error": e.to_string() })));
        }
    };
    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(Json(json!({ "ok": false, "error": e.to_string() })));
        }
    };
    let val: Value = match resp.json().await {
        Ok(v) => v,
        Err(e) => {
            return Ok(Json(json!({ "ok": false, "error": e.to_string() })));
        }
    };
    if val.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let desc = val
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("getMe failed — check the bot token.");
        return Ok(Json(json!({ "ok": false, "error": desc })));
    }
    let username = val["result"]["username"]
        .as_str()
        .unwrap_or("")
        .trim();
    if username.is_empty() {
        return Ok(Json(json!({ "ok": false, "error": "No username in getMe response" })));
    }
    let open_url = format!("https://t.me/{username}");
    Ok(Json(
        json!({ "ok": true, "username": username, "openUrl": open_url }),
    ))
}

#[derive(Deserialize)]
struct HarnessChatBody {
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct OrchestratorReplyBody {
    #[serde(default)]
    parent_tile_id: String,
    #[serde(default)]
    text: String,
    #[serde(default)]
    role: String,
    child_tile_id: Option<String>,
    session_id: Option<String>,
}

async fn orchestrator_reply(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<OrchestratorReplyBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(ref token) = state.bridge_token {
        let ok = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s == format!("Bearer {}", token))
            .unwrap_or(false);
        if !ok {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>" })),
            ));
        }
    }
    let parent = body.parent_tile_id.trim().to_string();
    let text = body.text.trim().to_string();
    if parent.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "parent_tile_id required" })),
        ));
    }
    if text.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "text required" })),
        ));
    }
    let role = if body.role.trim().is_empty() {
        "external".to_string()
    } else {
        body.role.trim().to_string()
    };
    match state
        .canvas
        .enqueue_orchestrator_reply(parent, text, role, body.child_tile_id, body.session_id)
        .await
    {
        Ok(reply) => Ok(Json(json!({ "ok": true, "reply": reply }))),
        Err(e) => Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "ok": false, "error": e.to_string() })),
        )),
    }
}

async fn harness_chat(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    Json(body): Json<HarnessChatBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, Json<Value>)> {
    if let Some(ref token) = state.bridge_token {
        let ok = headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s == format!("Bearer {}", token))
            .unwrap_or(false);
        if !ok {
            return Err((
                axum::http::StatusCode::UNAUTHORIZED,
                Json(json!({ "error": "Set Authorization: Bearer <CANVAS_BRIDGE_TOKEN>" })),
            ));
        }
    }
    let text = body.text.trim().to_string();
    if text.is_empty() {
        return Err((
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": "text required" })),
        ));
    }
    match state
        .canvas
        .enqueue_harness_chat(text)
        .await
    {
        Ok(reply) => Ok(Json(json!({ "ok": true, "reply": reply }))),
        Err(e) => Err((
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "ok": false, "error": e.to_string() })),
        )),
    }
}

#[derive(Deserialize)]
struct PathQ {
    path: Option<String>,
}

async fn get_files(
    State(state): State<AppState>,
    Query(q): Query<PathQ>,
) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    let dir_path = q.path.unwrap_or_else(|| ".".into());
    let full = resolve_allowed_read_path(&state, &dir_path)?;
    let mut rd = fs::read_dir(&full)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut files = Vec::new();
    loop {
        match rd.next_entry().await {
            Ok(Some(e)) => {
                let meta = e.file_type().await.ok();
                let is_dir = meta.map(|m| m.is_dir()).unwrap_or(false);
                let name = e.file_name().to_string_lossy().to_string();
                let path = full.join(&name);
                files.push(json!({
                    "name": name,
                    "isDirectory": is_dir,
                    "path": path.to_string_lossy().replace('\\', "/"),
                }));
            }
            Ok(None) => break,
            Err(e) => {
                return Err((axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
            }
        }
    }
    Ok(Json(json!({ "files": files, "path": dir_path })))
}

async fn get_file(
    State(state): State<AppState>,
    Query(q): Query<PathQ>,
) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    let file_path = q
        .path
        .ok_or_else(|| (axum::http::StatusCode::BAD_REQUEST, "path required".into()))?;
    let full = resolve_allowed_read_path(&state, &file_path)?;
    let content = fs::read_to_string(&full)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "content": content, "path": file_path })))
}

#[derive(Deserialize)]
struct FileBody {
    path: String,
    content: String,
}

async fn post_file(
    State(state): State<AppState>,
    Json(body): Json<FileBody>,
) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    let full = state.workspace.join(&body.path);
    let full = full.canonicalize().unwrap_or(full);
    if !full.starts_with(state.workspace.as_ref()) {
        return Err((axum::http::StatusCode::FORBIDDEN, "path escape".into()));
    }
    if let Some(parent) = full.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    fs::write(&full, body.content)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "success": true, "path": body.path })))
}

async fn delete_file(
    State(state): State<AppState>,
    Query(q): Query<PathQ>,
) -> Result<Json<Value>, (axum::http::StatusCode, String)> {
    let file_path = q
        .path
        .ok_or_else(|| (axum::http::StatusCode::BAD_REQUEST, "path required".into()))?;
    let full = state.workspace.join(&file_path);
    let full = full.canonicalize().unwrap_or(full);
    if !full.starts_with(state.workspace.as_ref()) {
        return Err((axum::http::StatusCode::FORBIDDEN, "path escape".into()));
    }
    fs::remove_file(&full)
        .await
        .map_err(|e| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "success": true, "path": file_path })))
}

async fn ws_upgrade(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws(socket, state))
}

fn send_json(out: &mpsc::UnboundedSender<String>, typ: &str, payload: Value) {
    let s = json!({ "type": typ, "payload": payload }).to_string();
    let _ = out.send(s);
}

fn agent_status_str(s: &agent_manager::AgentStatus) -> &'static str {
    use agent_manager::AgentStatus;
    match s {
        AgentStatus::Idle => "idle",
        AgentStatus::Working => "working",
        AgentStatus::Done => "done",
        AgentStatus::Error => "error",
    }
}

async fn handle_ws(socket: WebSocket, state: AppState) {
    let pty_subs: Arc<std::sync::Mutex<HashSet<String>>> =
        Arc::new(std::sync::Mutex::new(HashSet::new()));
    let agent_subs: Arc<std::sync::Mutex<HashSet<String>>> =
        Arc::new(std::sync::Mutex::new(HashSet::new()));

    let (mut ws_tx, mut ws_rx) = socket.split();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();

    let writer = tokio::spawn(async move {
        while let Some(text) = out_rx.recv().await {
            if ws_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    send_json(
        &out_tx,
        "connected",
        json!({ "message": "WebSocket connected" }),
    );

    let mut pty_rx = state.pty.subscribe();
    let out_p = out_tx.clone();
    let ps = Arc::clone(&pty_subs);
    let pty_fwd = tokio::spawn(async move {
        use tokio::sync::broadcast::error::RecvError;
        loop {
            match pty_rx.recv().await {
                Ok(ev) => {
                    let id = match &ev {
                        PtyEvent::Data { id, .. } | PtyEvent::Exit { id, .. } => id.clone(),
                    };
                    if !ps.lock().unwrap().contains(&id) {
                        continue;
                    }
                    let s = match ev {
                        PtyEvent::Data { id, data } => json!({
                            "type": "pty:data",
                            "payload": { "sessionId": id, "data": data }
                        })
                        .to_string(),
                        PtyEvent::Exit { id, exit_code } => json!({
                            "type": "pty:exit",
                            "payload": { "sessionId": id, "exitCode": exit_code }
                        })
                        .to_string(),
                    };
                    if out_p.send(s).is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });

    let mut agent_rx = state.agents.subscribe();
    let out_a = out_tx.clone();
    let ags = Arc::clone(&agent_subs);
    let agent_fwd = tokio::spawn(async move {
        use tokio::sync::broadcast::error::RecvError;
        loop {
            match agent_rx.recv().await {
                Ok(ev) => {
                    let id = match &ev {
                        AgentEvent::Data { id, .. }
                        | AgentEvent::Status { id, .. }
                        | AgentEvent::Exit { id, .. } => id.clone(),
                    };
                    if !ags.lock().unwrap().contains(&id) {
                        continue;
                    }
                    let s = match ev {
                        AgentEvent::Data { id, data } => json!({
                            "type": "agent:data",
                            "payload": { "agentId": id, "data": data }
                        })
                        .to_string(),
                        AgentEvent::Status { id, status } => json!({
                            "type": "agent:status",
                            "payload": { "agentId": id, "status": agent_status_str(&status) }
                        })
                        .to_string(),
                        AgentEvent::Exit { id, exit_code } => json!({
                            "type": "agent:exit",
                            "payload": { "agentId": id, "exitCode": exit_code }
                        })
                        .to_string(),
                    };
                    if out_a.send(s).is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            }
        }
    });

    let mut canvas_ui_task: Option<tokio::task::JoinHandle<()>> = None;
    let mut registered_headless_gateway = false;

    while let Some(Ok(msg)) = ws_rx.next().await {
        if let Message::Text(t) = msg {
            handle_ws_message(
                &state,
                &t,
                &out_tx,
                &pty_subs,
                &agent_subs,
                &mut canvas_ui_task,
                &mut registered_headless_gateway,
            )
            .await;
        }
    }

    if registered_headless_gateway {
        state.canvas.unregister_gateway_headless().await;
    }
    if let Some(t) = canvas_ui_task.take() {
        t.abort();
    }
    pty_fwd.abort();
    agent_fwd.abort();

    for sid in pty_subs.lock().unwrap().iter() {
        state.pty.kill(sid);
    }

    writer.abort();
}

async fn handle_ws_message(
    state: &AppState,
    raw: &str,
    out: &mpsc::UnboundedSender<String>,
    pty_subs: &Arc<std::sync::Mutex<HashSet<String>>>,
    agent_subs: &Arc<std::sync::Mutex<HashSet<String>>>,
    canvas_ui_task: &mut Option<tokio::task::JoinHandle<()>>,
    registered_headless_gateway: &mut bool,
) {
    let v: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => {
            send_json(out, "error", json!({ "message": "Invalid JSON" }));
            return;
        }
    };
    let typ = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
    let payload = v.get("payload").cloned().unwrap_or(Value::Null);

    macro_rules! str {
        ($k:expr) => {
            payload.get($k).and_then(|x| x.as_str()).map(|s| s.to_string())
        };
    }

    match typ {
        "pty:spawn" => {
            let shell = str!("shell");
            let cwd = str!("cwd");
            let cols = payload.get("cols").and_then(|x| x.as_u64()).unwrap_or(80) as u16;
            let rows = payload.get("rows").and_then(|x| x.as_u64()).unwrap_or(24) as u16;
            match state.pty.spawn(shell.as_deref(), cwd.as_deref(), cols, rows) {
                Ok(id) => {
                    pty_subs.lock().unwrap().insert(id.clone());
                    send_json(out, "pty:spawned", json!({ "sessionId": id }));
                }
                Err(e) => {
                    send_json(
                        out,
                        "error",
                        json!({ "message": format!("pty spawn failed: {}", e) }),
                    );
                }
            }
        }
        "pty:write" => {
            if let (Some(id), Some(data)) = (str!("sessionId"), str!("data")) {
                state.pty.write(&id, &data);
            }
        }
        "pty:resize" => {
            if let (Some(id), Some(c), Some(r)) = (
                str!("sessionId"),
                payload.get("cols").and_then(|x| x.as_u64()),
                payload.get("rows").and_then(|x| x.as_u64()),
            ) {
                state.pty.resize(&id, c as u16, r as u16);
            }
        }
        "pty:kill" => {
            if let Some(id) = str!("sessionId") {
                state.pty.kill(&id);
                pty_subs.lock().unwrap().remove(&id);
            }
        }
        "agent:create" => {
            let t = payload.get("agentType").and_then(|x| x.as_str()).unwrap_or("custom");
            let agent_type = match t {
                "claude" => AgentType::Claude,
                "codex" => AgentType::Codex,
                "gemini" => AgentType::Gemini,
                _ => AgentType::Custom,
            };
            let a = state.agents.create_agent(
                agent_type,
                str!("name").as_deref(),
                str!("command").as_deref(),
                str!("cwd").as_deref(),
            );
            agent_subs.lock().unwrap().insert(a.id.clone());
            let v = serde_json::to_value(&a).unwrap_or_else(|_| json!({}));
            send_json(out, "agent:created", v);
        }
        "agent:start" => {
            if let Some(id) = str!("agentId") {
                agent_subs.lock().unwrap().insert(id.clone());
                if let Err(e) = state.agents.start_agent(&id) {
                    send_json(
                        out,
                        "error",
                        json!({ "message": format!("agent start: {}", e) }),
                    );
                }
            }
        }
        "agent:input" => {
            if let (Some(id), Some(d)) = (str!("agentId"), str!("data")) {
                state.agents.send_input(&id, &d);
            }
        }
        "agent:task" => {
            if let (Some(id), Some(t)) = (str!("agentId"), str!("task")) {
                state.agents.send_task(&id, &t);
            }
        }
        "agent:stop" => {
            if let Some(id) = str!("agentId") {
                state.agents.stop_agent(&id);
            }
        }
        "agent:remove" => {
            if let Some(id) = str!("agentId") {
                state.agents.remove_agent(&id);
                agent_subs.lock().unwrap().remove(&id);
            }
        }
        "agent:list" => {
            let list: Vec<AgentJson> = state.agents.get_agent_list();
            let arr = serde_json::to_value(list).unwrap_or_else(|_| json!([]));
            send_json(out, "agent:list", arr);
        }
        "canvas:register" => {
            let role = payload.get("role").and_then(|x| x.as_str());
            let agent = payload
                .get("agent")
                .and_then(|x| x.as_str())
                .unwrap_or("ui");
            if role == Some("ui") {
                if canvas_ui_task.is_none() {
                    let mut canvas_rx = state.canvas.subscribe();
                    let out_c = out.clone();
                    let h = tokio::spawn(async move {
                        use tokio::sync::broadcast::error::RecvError;
                        loop {
                            match canvas_rx.recv().await {
                                Ok(s) => {
                                    if out_c.send(s).is_err() {
                                        break;
                                    }
                                }
                                Err(RecvError::Lagged(_)) => continue,
                                Err(RecvError::Closed) => break,
                            }
                        }
                    });
                    *canvas_ui_task = Some(h);
                }
                if agent == "orca-headless" {
                    state.canvas.register_gateway_headless(out.clone()).await;
                    *registered_headless_gateway = true;
                }
            }
            send_json(
                out,
                "canvas:registered",
                json!({ "ok": true, "role": role, "agent": agent }),
            );
        }
        "canvas:result" => {
            let rid = payload.get("requestId").and_then(|x| x.as_str());
            let res = payload.get("result").and_then(|x| x.as_str());
            if let (Some(rid), Some(res)) = (rid, res) {
                state.canvas.complete(rid, res.to_string()).await;
            }
        }
        "gateway:telegram:result" => {
            let rid = payload.get("requestId").and_then(|x| x.as_str());
            let text = payload.get("text").and_then(|x| x.as_str());
            if let (Some(rid), Some(text)) = (rid, text) {
                state.canvas.complete_gateway(rid, text.to_string()).await;
            }
        }
        "orchestrator:reply:result" => {
            let rid = payload.get("requestId").and_then(|x| x.as_str());
            let res = payload.get("result").and_then(|x| x.as_str());
            if let (Some(rid), Some(res)) = (rid, res) {
                state
                    .canvas
                    .complete_orchestrator_reply(rid, res.to_string())
                    .await;
            }
        }
        _ => {
            send_json(
                out,
                "error",
                json!({ "message": format!("Unknown message type: {}", typ) }),
            );
        }
    }
}
