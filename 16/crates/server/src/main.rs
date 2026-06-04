mod api;
mod simulation;
mod ws;

use axum::Router;
use ipc_debugger_core::ebpf::EbpfManager;
use ipc_debugger_core::injection::InjectionEngine;
use ipc_debugger_core::storage::MessageStore;
use ipc_debugger_core::{CaptureConfig, IpcMessage};
use std::sync::Arc;
use tokio::sync::broadcast;
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

pub struct AppState {
    pub store: MessageStore,
    pub ebpf: Arc<Mutex<EbpfManager>>,
    pub injection: InjectionEngine,
    pub tx: broadcast::Sender<String>,
    pub simulation_running: Arc<tokio::sync::Mutex<bool>>,
    pub message_store_tx: std::sync::mpsc::Sender<IpcMessage>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("ipc_debugger_server=debug,ipc_debugger_core=debug")
        .init();

    let (tx, _) = broadcast::channel(10000);
    let config = CaptureConfig::default();
    let store = MessageStore::new(config.max_ring_buffer_size)?;
    let ebpf = Arc::new(Mutex::new(EbpfManager::new(config)));
    let injection = InjectionEngine::new();
    let simulation_running = Arc::new(tokio::sync::Mutex::new(false));

    let (message_store_tx, message_store_rx) = std::sync::mpsc::channel::<IpcMessage>();
    let store_clone = store.clone();
    std::thread::Builder::new()
        .name("message-store-worker".to_string())
        .spawn(move || {
            while let Ok(msg) = message_store_rx.recv() {
                let store = store_clone.clone();
                tokio::runtime::Handle::current().block_on(async move {
                    if let Err(e) = store.insert(&msg).await {
                        tracing::warn!("Store insert error: {e}");
                    }
                });
            }
        })?;

    let state = Arc::new(AppState {
        store,
        ebpf,
        injection,
        tx: tx.clone(),
        simulation_running,
        message_store_tx: message_store_tx.clone(),
    });

    simulation::start_simulator(state.clone());

    let app = Router::new()
        .nest("/api", api::routes())
        .route("/ws", axum::routing::get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:9222").await?;
    tracing::info!("IPC Debugger server listening on http://0.0.0.0:9222");
    axum::serve(listener, app).await?;

    Ok(())
}
