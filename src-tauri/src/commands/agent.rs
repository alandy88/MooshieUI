//! Agent runtime client — streaming OpenAI-compatible chat completions.
//!
//! Phase 3 of the agentic image app (frontend design §"Agent runtime"). The
//! agent's job is intent → request Spec: the frontend assembles the system
//! prompt (request-Spec shape + available Profiles) and the conversation, calls
//! `agent_chat`, and this module streams `POST {base}/chat/completions` to the
//! configurable runtime (default `http://llm.lif.home/v1`). Tokens are fanned to
//! the chat panel over the same dual emit path generation events use:
//! `app.emit` for the Tauri webview and `state.broadcast` for SSE/browser mode.
//!
//! Events emitted (all carry `request_id` so the panel can route concurrent
//! turns): `agent:token` `{ request_id, token }`, `agent:done` `{ request_id }`,
//! `agent:error` `{ request_id, error }`.
//!
//! The model never drives a loop here (ADR 0002): this is one streamed
//! completion. Structured output (the request Spec) is parsed client-side from a
//! fenced ```json block in the reply — no tool-calling dependency on the local
//! model.

use std::sync::Arc;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};

use crate::error::AppError;
use crate::state::AppState;

/// One OpenAI-compatible chat message. Mirrors what the frontend sends.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Emit an agent event to both the Tauri webview (if a handle is set) and SSE
/// clients — the same pattern as `commands::server::emit_both`, but sourcing the
/// handle from `AppState` so the browser-mode dispatch path works without a
/// command-provided `AppHandle`.
async fn emit_agent(state: &AppState, event: &str, payload: serde_json::Value) {
    let handle = state.app_handle.lock().await.clone();
    if let Some(app) = handle {
        let _ = app.emit(event, payload.clone());
    }
    state.broadcast(event, payload);
}

/// Stream a chat completion, emitting tokens as they arrive. Shared by the Tauri
/// command and the browser-mode dispatch path. Returns when the stream completes
/// (after emitting `agent:done`) or errors (after emitting `agent:error`).
pub async fn run_agent_chat(
    state: &AppState,
    messages: Vec<ChatMessage>,
    request_id: String,
) -> Result<(), AppError> {
    let (base_url, api_key, model) = {
        let config = state.config.read().await;
        (
            config.agent_base_url.trim_end_matches('/').to_string(),
            config.agent_api_key.clone(),
            config.agent_model.clone(),
        )
    };

    let url = format!("{base_url}/chat/completions");
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    let mut req = state.http_client.post(&url).json(&body);
    if let Some(key) = api_key.as_deref() {
        if !key.trim().is_empty() {
            req = req.bearer_auth(key.trim());
        }
    }

    // A connection failure is reported through the event channel (so the panel
    // shows it inline) and also returned as an error for the invoke caller.
    let resp = match req.send().await {
        Ok(resp) => resp,
        Err(e) => {
            let msg = format!("agent request failed: {e}");
            emit_agent(state, "agent:error", serde_json::json!({ "request_id": request_id, "error": msg })).await;
            return Err(AppError::HttpError(e));
        }
    };

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let detail = resp.text().await.unwrap_or_default();
        let msg = format!("agent runtime returned {status}: {}", detail.trim());
        emit_agent(state, "agent:error", serde_json::json!({ "request_id": request_id, "error": msg })).await;
        return Err(AppError::ApiError { status, message: detail });
    }

    let mut stream = resp.bytes_stream();
    // OpenAI streams `data: {json}\n\n` frames; chunk boundaries don't respect
    // line boundaries (and may split a multibyte UTF-8 char), so buffer raw
    // bytes and only decode complete lines — line breaks are ASCII '\n', so a
    // full line is always valid UTF-8.
    let mut buffer: Vec<u8> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("agent stream interrupted: {e}");
                emit_agent(state, "agent:error", serde_json::json!({ "request_id": request_id, "error": msg })).await;
                return Err(AppError::HttpError(e));
            }
        };
        buffer.extend_from_slice(&chunk);

        while let Some(newline) = buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buffer.drain(..=newline).collect();
            let line = String::from_utf8_lossy(&line_bytes[..line_bytes.len() - 1]);
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Some(data) = line.strip_prefix("data:") else {
                continue; // ignore SSE comments / non-data lines
            };
            let data = data.trim();
            if data == "[DONE]" {
                emit_agent(state, "agent:done", serde_json::json!({ "request_id": request_id })).await;
                return Ok(());
            }
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(token) = value["choices"][0]["delta"]["content"].as_str() {
                    if !token.is_empty() {
                        emit_agent(
                            state,
                            "agent:token",
                            serde_json::json!({ "request_id": request_id, "token": token }),
                        )
                        .await;
                    }
                }
            }
        }
    }

    // Stream ended without an explicit [DONE] sentinel — still a clean finish.
    emit_agent(state, "agent:done", serde_json::json!({ "request_id": request_id })).await;
    Ok(())
}

/// Stream an agent chat completion (desktop/Tauri command). Tokens arrive via
/// `agent:token` events while this resolves on completion.
#[cfg(feature = "desktop")]
#[tauri::command]
pub async fn agent_chat(
    state: State<'_, Arc<AppState>>,
    messages: Vec<ChatMessage>,
    request_id: String,
) -> Result<(), AppError> {
    run_agent_chat(&state, messages, request_id).await
}
