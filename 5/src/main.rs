mod api;
mod ingest;
mod query;
mod schema;
mod storage;

use std::sync::Arc;
use std::time::Duration;

use storage::buffer::StreamBuffer;
use storage::parquet_store::ParquetStore;
use query::engine::QueryEngine;
use query::views::ViewManager;

async fn flush_task(buffer: Arc<StreamBuffer>, store: Arc<ParquetStore>, view_manager: Arc<ViewManager>) {
    let mut interval = tokio::time::interval(Duration::from_secs(30));

    loop {
        interval.tick().await;

        if buffer.should_flush() {
            if let Some(batch) = buffer.compact_and_drain() {
                let rows = batch.num_rows();
                match store.write_batch(&batch) {
                    Ok(_) => {
                        tracing::info!("Flushed {} rows to Parquet", rows);
                        view_manager.mark_write_triggered();
                    }
                    Err(e) => {
                        tracing::error!("Failed to flush: {}", e);
                        buffer.append(batch);
                    }
                }
            }
        }
    }
}

async fn view_refresh_task(view_manager: Arc<ViewManager>) {
    let mut interval = tokio::time::interval(Duration::from_secs(5));

    loop {
        interval.tick().await;
        view_manager.refresh_all_due().await;
    }
}

#[tokio::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter("ts-analytics=info")
        .init();

    let data_dir = std::env::var("DATA_DIR").unwrap_or_else(|_| "./data".to_string());
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let buffer = Arc::new(StreamBuffer::new());
    let parquet_store = Arc::new(ParquetStore::new(&data_dir));
    let view_manager = Arc::new(ViewManager::new());
    let engine = Arc::new(QueryEngine::new(buffer.clone(), parquet_store.clone(), view_manager.clone()));

    tracing::info!("Data directory: {}", data_dir);
    tracing::info!("Starting server on port {}", port);

    let flush_buffer = buffer.clone();
    let flush_store = parquet_store.clone();
    let flush_vm = view_manager.clone();
    tokio::spawn(async move {
        flush_task(flush_buffer, flush_store, flush_vm).await;
    });

    let refresh_vm = view_manager.clone();
    tokio::spawn(async move {
        view_refresh_task(refresh_vm).await;
    });

    api::server::run_server(buffer, parquet_store, engine, view_manager, port).await
}
