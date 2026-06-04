use axum::{
    extract::{Path, Query, State},
    response::Json,
    routing::{get, post},
    Router,
};
use ipc_debugger_core::models::*;
use serde::Deserialize;
use std::sync::Arc;

use crate::AppState;

pub fn routes() -> Router<Arc<AppState>> {
    Router::new()
        .route("/messages", get(list_messages))
        .route("/messages/{id}", get(get_message))
        .route("/process-tree", get(get_process_tree))
        .route("/capture/start", post(start_capture))
        .route("/capture/stop", post(stop_capture))
        .route("/capture/config", get(get_config).post(update_config))
        .route("/capture/stats", get(get_buffer_stats))
        .route("/capture/reset-dropped", post(reset_dropped_count))
        .route("/inject", post(inject_message))
        .route("/replay", post(start_replay))
}

#[derive(Deserialize)]
struct ListMessagesQuery {
    source_pid: Option<u32>,
    target_pid: Option<u32>,
    ipc_type: Option<String>,
    search: Option<String>,
    time_start: Option<i64>,
    time_end: Option<i64>,
    limit: Option<u64>,
    offset: Option<u64>,
}

async fn list_messages(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListMessagesQuery>,
) -> Json<Vec<IpcMessage>> {
    let ipc_type = q.ipc_type.and_then(|s| serde_json::from_str(&format!("\"{s}\"")).ok());
    let filter = MessageFilter {
        source_pid: q.source_pid,
        target_pid: q.target_pid,
        ipc_type,
        search_text: q.search,
        time_start: q.time_start,
        time_end: q.time_end,
        limit: q.limit.or(Some(100)),
        offset: q.offset,
    };
    match state.store.query(&filter).await {
        Ok(msgs) => Json(msgs),
        Err(e) => {
            tracing::error!("Query error: {e}");
            Json(vec![])
        }
    }
}

async fn get_message(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Json<Option<IpcMessage>> {
    match state.store.get_by_id(&id).await {
        Ok(msg) => Json(msg),
        Err(e) => {
            tracing::error!("Get message error: {e}");
            Json(None)
        }
    }
}

async fn get_process_tree(State(state): State<Arc<AppState>>) -> Json<ProcessTree> {
    match state.store.get_process_tree().await {
        Ok(tree) => Json(tree),
        Err(e) => {
            tracing::error!("Process tree error: {e}");
            Json(ProcessTree { nodes: vec![] })
        }
    }
}

async fn start_capture(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut ebpf = state.ebpf.lock().await;
    match ebpf
        .attach(state.tx.clone(), state.message_store_tx.clone())
        .await
    {
        Ok(()) => Json(serde_json::json!({"status": "attached"})),
        Err(e) => Json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn stop_capture(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let mut ebpf = state.ebpf.lock().await;
    match ebpf.detach().await {
        Ok(()) => Json(serde_json::json!({"status": "detached"})),
        Err(e) => Json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn get_config(State(state): State<Arc<AppState>>) -> Json<CaptureConfig> {
    let ebpf = state.ebpf.lock().await;
    Json(ebpf.get_config().await)
}

async fn update_config(
    State(state): State<Arc<AppState>>,
    Json(config): Json<CaptureConfig>,
) -> Json<serde_json::Value> {
    let ebpf = state.ebpf.lock().await;
    match ebpf.update_config(config).await {
        Ok(()) => Json(serde_json::json!({"status": "updated"})),
        Err(e) => Json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn get_buffer_stats(
    State(state): State<Arc<AppState>>,
) -> Json<ipc_debugger_core::models::BufferStats> {
    let ebpf = state.ebpf.lock().await;
    Json(ebpf.get_buffer_stats().await)
}

async fn reset_dropped_count(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let ebpf = state.ebpf.lock().await;
    ebpf.reset_dropped_count().await;
    Json(serde_json::json!({"status": "reset"}))
}

async fn inject_message(
    State(state): State<Arc<AppState>>,
    Json(req): Json<InjectRequest>,
) -> Json<serde_json::Value> {
    match state.injection.inject_message(&req) {
        Ok(result) => Json(serde_json::to_value(result).unwrap()),
        Err(e) => Json(serde_json::json!({"error": e.to_string()})),
    }
}

async fn start_replay(
    State(state): State<Arc<AppState>>,
    Json(filter): Json<MessageFilter>,
) -> Json<ReplayState> {
    match state.store.get_messages_for_replay(&filter).await {
        Ok(messages) => {
            Json(ReplayState {
                id: uuid::Uuid::new_v4().to_string(),
                messages,
                current_index: 0,
                is_paused: true,
                speed: 1.0,
            })
        }
        Err(e) => {
            tracing::error!("Replay error: {e}");
            Json(ReplayState {
                id: uuid::Uuid::new_v4().to_string(),
                messages: vec![],
                current_index: 0,
                is_paused: true,
                speed: 1.0,
            })
        }
    }
}
