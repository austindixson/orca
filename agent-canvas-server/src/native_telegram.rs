//! Long-poll Telegram `getUpdates` and forward messages to the canvas bridge (same WebSocket as `canvas:invoke`).

use std::collections::HashSet;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;

use crate::canvas_bridge::CanvasBridge;

const TELEGRAM_MAX_MESSAGE: usize = 4096;
/// Telegram clears typing after ~5s; refresh so long orchestrator runs stay visible.
const TELEGRAM_TYPING_INTERVAL_SECS: u64 = 4;

#[derive(Clone)]
pub struct TelegramGateway {
    inner: Arc<tokio::sync::Mutex<TelegramGatewayInner>>,
}

struct TelegramGatewayInner {
    join: Option<tokio::task::JoinHandle<()>>,
}

impl TelegramGateway {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(tokio::sync::Mutex::new(TelegramGatewayInner { join: None })),
        }
    }

    pub async fn is_running(&self) -> bool {
        self.inner.lock().await.join.is_some()
    }

    pub async fn stop(&self) -> anyhow::Result<()> {
        let mut g = self.inner.lock().await;
        if let Some(h) = g.join.take() {
            h.abort();
        }
        Ok(())
    }

    pub async fn start(
        &self,
        canvas: Arc<CanvasBridge>,
        token: String,
        allowed_user_ids: Option<HashSet<i64>>,
    ) -> anyhow::Result<()> {
        self.stop().await?;
        let tok = token.trim().to_string();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()?;

        let h = tokio::spawn(async move {
            run_polling_loop(client, tok, canvas, allowed_user_ids).await;
        });

        let mut g = self.inner.lock().await;
        g.join = Some(h);
        Ok(())
    }
}

async fn run_polling_loop(
    client: reqwest::Client,
    token: String,
    canvas: Arc<CanvasBridge>,
    allowed: Option<HashSet<i64>>,
) {
    let mut offset: Option<i64> = None;
    loop {
        let mut url = format!(
            "https://api.telegram.org/bot{}/getUpdates?timeout=30",
            token
        );
        if let Some(o) = offset {
            url.push_str(&format!("&offset={}", o));
        }

        let resp = match client.get(&url).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!("[Gateway] getUpdates request failed: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                continue;
            }
        };

        let body: GetUpdatesResponse = match resp.json().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("[Gateway] getUpdates JSON failed: {}", e);
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                continue;
            }
        };

        if !body.ok {
            tracing::warn!("[Gateway] getUpdates ok=false");
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            continue;
        }

        for update in body.result {
            offset = Some(update.update_id + 1);
            let Some(msg) = update.message else {
                continue;
            };
            let Some(text) = msg.text else {
                continue;
            };
            let text = text.trim().to_string();
            if text.is_empty() {
                let _ = send_telegram_message(&client, &token, msg.chat.id, "Send a non-empty message.")
                    .await;
                continue;
            }

            let uid = msg.from.as_ref().map(|u| u.id);
            if let (Some(ref allow), Some(uid)) = (&allowed, uid) {
                if !allow.contains(&uid) {
                    let _ = send_telegram_message(
                        &client,
                        &token,
                        msg.chat.id,
                        "You are not allowed to use this Orca bot. Add your Telegram user id to the allowlist in Orca Settings (Integrations).",
                    )
                    .await;
                    continue;
                }
            }

            let username = msg
                .from
                .as_ref()
                .and_then(|u| u.username.clone());

            let chat_id = msg.chat.id;
            let client_typing = client.clone();
            let token_typing = token.clone();
            let typing_handle = tokio::spawn(async move {
                loop {
                    let _ = send_chat_action(&client_typing, &token_typing, chat_id).await;
                    tokio::time::sleep(std::time::Duration::from_secs(
                        TELEGRAM_TYPING_INTERVAL_SECS,
                    ))
                    .await;
                }
            });

            let enqueue_result = canvas
                .enqueue_gateway_telegram(chat_id, text, username)
                .await;
            typing_handle.abort();
            let _ = typing_handle.await;

            match enqueue_result {
                Ok(reply) => {
                    let _ = send_telegram_message(&client, &token, chat_id, &truncate_telegram(&reply))
                        .await;
                }
                Err(e) => {
                    let err = format!("Orca: {}", e);
                    let _ = send_telegram_message(&client, &token, chat_id, &truncate_telegram(&err))
                        .await;
                }
            }
        }
    }
}

fn truncate_telegram(s: &str) -> String {
    if s.chars().count() <= TELEGRAM_MAX_MESSAGE {
        return s.to_string();
    }
    let take = TELEGRAM_MAX_MESSAGE.saturating_sub(20);
    let head: String = s.chars().take(take).collect();
    format!("{head}\n…(truncated)")
}

async fn send_chat_action(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
) -> anyhow::Result<()> {
    let url = format!("https://api.telegram.org/bot{}/sendChatAction", token);
    let res = client
        .post(&url)
        .json(&json!({ "chat_id": chat_id, "action": "typing" }))
        .send()
        .await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::warn!("[Gateway] sendChatAction failed {}: {}", status, body);
    }
    Ok(())
}

async fn send_telegram_message(
    client: &reqwest::Client,
    token: &str,
    chat_id: i64,
    text: &str,
) -> anyhow::Result<()> {
    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let res = client
        .post(&url)
        .json(&json!({ "chat_id": chat_id, "text": text }))
        .send()
        .await?;
    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        tracing::warn!("[Gateway] sendMessage failed {}: {}", status, body);
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
struct GetUpdatesResponse {
    ok: bool,
    result: Vec<TelegramUpdate>,
}

#[derive(Debug, Deserialize)]
struct TelegramUpdate {
    update_id: i64,
    message: Option<TelegramMessage>,
}

#[derive(Debug, Deserialize)]
struct TelegramMessage {
    text: Option<String>,
    chat: TelegramChat,
    from: Option<TelegramUser>,
}

#[derive(Debug, Deserialize)]
struct TelegramChat {
    id: i64,
}

#[derive(Debug, Deserialize)]
struct TelegramUser {
    id: i64,
    username: Option<String>,
}
