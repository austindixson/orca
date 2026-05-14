use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{mpsc, Mutex, oneshot};

#[derive(Clone)]
pub struct CanvasBridge {
    broadcast: tokio::sync::broadcast::Sender<String>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    pending_gateway: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    pending_orchestrator: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
    /// Direct channel for `orca-headless` WebSocket — Telegram / harness chat prefer this over broadcast.
    gateway_headless_tx: Arc<Mutex<Option<mpsc::UnboundedSender<String>>>>,
    headless_registered: Arc<AtomicBool>,
}

impl CanvasBridge {
    pub fn new() -> Self {
        let (broadcast, _) = tokio::sync::broadcast::channel::<String>(256);
        Self {
            broadcast,
            pending: Arc::new(Mutex::new(HashMap::new())),
            pending_gateway: Arc::new(Mutex::new(HashMap::new())),
            pending_orchestrator: Arc::new(Mutex::new(HashMap::new())),
            gateway_headless_tx: Arc::new(Mutex::new(None)),
            headless_registered: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn subscriber_count(&self) -> usize {
        self.broadcast.receiver_count()
    }

    pub fn headless_gateway_registered(&self) -> bool {
        self.headless_registered.load(Ordering::Relaxed)
    }

    pub async fn register_gateway_headless(&self, tx: mpsc::UnboundedSender<String>) {
        *self.gateway_headless_tx.lock().await = Some(tx);
        self.headless_registered.store(true, Ordering::Relaxed);
    }

    pub async fn unregister_gateway_headless(&self) {
        *self.gateway_headless_tx.lock().await = None;
        self.headless_registered.store(false, Ordering::Relaxed);
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.broadcast.subscribe()
    }

    pub async fn invoke_tool(&self, tool: String, args_json: String) -> anyhow::Result<String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        {
            self.pending.lock().await.insert(request_id.clone(), tx);
        }
        let payload = serde_json::json!({
            "type": "canvas:invoke",
            "payload": {
                "requestId": request_id,
                "tool": tool,
                "arguments": args_json
            }
        })
        .to_string();

        if self.broadcast.send(payload).is_err() {
            self.pending.lock().await.remove(&request_id);
            anyhow::bail!(
                "No Orca Coder window is connected. Start the app with the dev server and keep a UI session open."
            );
        }

        tokio::time::timeout(Duration::from_secs(90), rx)
            .await
            .map_err(|_| anyhow::anyhow!("Canvas tool timed out waiting for UI (90s)"))?
            .map_err(|_| anyhow::anyhow!("Canvas tool channel closed"))
    }

    pub async fn complete(&self, request_id: &str, result: String) {
        if let Some(tx) = self.pending.lock().await.remove(request_id) {
            let _ = tx.send(result);
        }
    }

    /// Forward an inbound Telegram message to connected Orca UIs; wait for `gateway:telegram:result`.
    pub async fn enqueue_gateway_telegram(
        &self,
        chat_id: i64,
        text: String,
        username: Option<String>,
    ) -> anyhow::Result<String> {
        self.enqueue_gateway_message(chat_id, text, username, false)
            .await
    }

    /// Same pipeline as Telegram, for CLI `orca chat` — `source: harness`.
    pub async fn enqueue_harness_chat(&self, text: String) -> anyhow::Result<String> {
        self.enqueue_gateway_message(0, text, None, true).await
    }

    async fn enqueue_gateway_message(
        &self,
        chat_id: i64,
        text: String,
        username: Option<String>,
        harness: bool,
    ) -> anyhow::Result<String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        {
            self.pending_gateway
                .lock()
                .await
                .insert(request_id.clone(), tx);
        }
        let payload = serde_json::json!({
            "type": "gateway:telegram",
            "payload": {
                "requestId": request_id,
                "chatId": chat_id,
                "text": text,
                "username": username,
                "source": if harness { "harness" } else { "telegram" }
            }
        })
        .to_string();

        let sent = {
            let head = self.gateway_headless_tx.lock().await;
            if let Some(ref tx) = *head {
                tx.send(payload.clone()).is_ok()
            } else {
                false
            }
        };

        if !sent && self.broadcast.send(payload).is_err() {
            self.pending_gateway.lock().await.remove(&request_id);
            anyhow::bail!(
                "No Orca UI is connected to the canvas bridge (uiClients: 0). Keep this Orca window open on the same machine as the server, run `npm run dev` or `tauri dev` so :3001 is up, and do not set VITE_ENABLE_CANVAS_BRIDGE=false. Check GET /api/canvas/bridge-status — uiClients must be >= 1 before Telegram works."
            );
        }

        tokio::time::timeout(Duration::from_secs(300), rx)
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "Timed out waiting for Orca (keep the app open, canvas bridge enabled, and try again)."
                )
            })?
            .map_err(|_| anyhow::anyhow!("Gateway reply channel closed"))
    }

    pub async fn complete_gateway(&self, request_id: &str, result: String) {
        if let Some(tx) = self.pending_gateway.lock().await.remove(request_id) {
            let _ = tx.send(result);
        }
    }

    /// Forward `orca reply` / external completion to Orca UIs; wait for `orchestrator:reply:result`.
    pub async fn enqueue_orchestrator_reply(
        &self,
        parent_tile_id: String,
        text: String,
        role: String,
        child_tile_id: Option<String>,
        session_id: Option<String>,
    ) -> anyhow::Result<String> {
        let request_id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        {
            self.pending_orchestrator
                .lock()
                .await
                .insert(request_id.clone(), tx);
        }
        let payload = serde_json::json!({
            "type": "orchestrator:reply",
            "payload": {
                "requestId": request_id,
                "parentTileId": parent_tile_id,
                "childTileId": child_tile_id,
                "role": role,
                "text": text,
                "sessionId": session_id
            }
        })
        .to_string();

        let sent = {
            let head = self.gateway_headless_tx.lock().await;
            if let Some(ref tx) = *head {
                tx.send(payload.clone()).is_ok()
            } else {
                false
            }
        };

        if !sent && self.broadcast.send(payload).is_err() {
            self.pending_orchestrator.lock().await.remove(&request_id);
            anyhow::bail!(
                "No Orca UI is connected to the canvas bridge (uiClients: 0). Keep this Orca window open on the same machine as the server."
            );
        }

        tokio::time::timeout(Duration::from_secs(300), rx)
            .await
            .map_err(|_| {
                anyhow::anyhow!(
                    "Timed out waiting for Orca (keep the app open, canvas bridge enabled, and try again)."
                )
            })?
            .map_err(|_| anyhow::anyhow!("Orchestrator reply channel closed"))
    }

    pub async fn complete_orchestrator_reply(&self, request_id: &str, result: String) {
        if let Some(tx) = self.pending_orchestrator.lock().await.remove(request_id) {
            let _ = tx.send(result);
        }
    }
}
