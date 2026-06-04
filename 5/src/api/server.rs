use actix_cors::Cors;
use actix_web::{web, App, HttpServer, HttpResponse, middleware};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::query::engine::QueryEngine;
use crate::query::views::{RefreshStrategy, ViewManager};
use crate::storage::buffer::StreamBuffer;
use crate::storage::parquet_store::ParquetStore;
use crate::ingest::generator;

#[derive(Deserialize)]
pub struct IngestRequest {
    pub device_id: String,
    pub location: Option<String>,
    pub temperature: Option<f64>,
    pub humidity: Option<f64>,
    pub vibration: Option<f64>,
    pub pressure: Option<f64>,
}

#[derive(Deserialize)]
pub struct QueryRequest {
    pub sql: String,
}

#[derive(Serialize)]
pub struct QueryResponse {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub row_count: usize,
    pub elapsed_ms: u64,
}

#[derive(Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
}

#[derive(Serialize)]
pub struct IngestResponse {
    pub status: String,
    pub rows_ingested: usize,
}

#[derive(Serialize)]
pub struct StatusResponse {
    pub stream_buffer_rows: usize,
    pub parquet_partitions: Vec<String>,
    pub materialized_views: Vec<MaterializedViewInfo>,
    pub status: String,
}

#[derive(Serialize)]
pub struct MaterializedViewInfo {
    pub name: String,
    pub sql: String,
    pub refresh_strategy: String,
    pub last_update: Option<String>,
    pub row_count: usize,
    pub table_name: String,
}

#[derive(Deserialize)]
pub struct CreateViewRequest {
    pub name: String,
    pub sql: String,
    pub refresh_strategy: String,
    pub interval_secs: Option<u64>,
    pub debounce_secs: Option<u64>,
}

pub struct AppState {
    pub buffer: Arc<StreamBuffer>,
    pub parquet_store: Arc<ParquetStore>,
    pub engine: Arc<QueryEngine>,
    pub view_manager: Arc<ViewManager>,
}

async fn ingest_handler(
    state: web::Data<AppState>,
    body: web::Json<IngestRequest>,
) -> HttpResponse {
    let batch = generator::generate_single(
        &body.device_id,
        body.location.as_deref().unwrap_or("unknown"),
    );
    let rows = batch.num_rows();
    state.buffer.append(batch);
    state.view_manager.mark_write_triggered();

    HttpResponse::Ok().json(IngestResponse {
        status: "ok".to_string(),
        rows_ingested: rows,
    })
}

async fn ingest_batch_handler(
    state: web::Data<AppState>,
    body: web::Json<BatchIngestRequest>,
) -> HttpResponse {
    let batch = generator::generate_batch(body.device_count, body.rows_per_device);
    let rows = batch.num_rows();
    state.buffer.append(batch);
    state.view_manager.mark_write_triggered();

    HttpResponse::Ok().json(IngestResponse {
        status: "ok".to_string(),
        rows_ingested: rows,
    })
}

#[derive(Deserialize)]
pub struct BatchIngestRequest {
    pub device_count: usize,
    pub rows_per_device: usize,
}

async fn query_handler(
    state: web::Data<AppState>,
    body: web::Json<QueryRequest>,
) -> HttpResponse {
    let start = std::time::Instant::now();

    match state.engine.execute_sql(&body.sql).await {
        Ok(batches) => {
            let elapsed = start.elapsed().as_millis() as u64;

            let mut columns = Vec::new();
            let mut rows = Vec::new();

            if !batches.is_empty() {
                let schema = batches[0].schema();
                for field in schema.fields() {
                    columns.push(ColumnInfo {
                        name: field.name().clone(),
                        data_type: format!("{:?}", field.data_type()),
                    });
                }

                for batch in &batches {
                    for row_idx in 0..batch.num_rows() {
                        let mut row = Vec::new();
                        for col_idx in 0..batch.num_columns() {
                            let col = batch.column(col_idx);
                            let val = arrow_value_to_json(col, row_idx);
                            row.push(val);
                        }
                        rows.push(row);
                    }
                }
            }

            let row_count = rows.len();
            HttpResponse::Ok().json(QueryResponse {
                columns,
                rows,
                row_count,
                elapsed_ms: elapsed,
            })
        }
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({
            "error": e.to_string()
        })),
    }
}

async fn status_handler(state: web::Data<AppState>) -> HttpResponse {
    let buffer_rows = state.buffer.row_count();
    let partitions = state.parquet_store.list_partitions();

    let views = state.view_manager.list_views();
    let view_infos: Vec<MaterializedViewInfo> = views
        .into_iter()
        .map(|v| {
            let last_update = v.last_update_micros.read().and_then(|micros| {
                chrono::DateTime::from_timestamp_micros(micros)
                    .map(|dt| dt.to_rfc3339())
            });
            MaterializedViewInfo {
                name: v.name.clone(),
                sql: v.sql.clone(),
                refresh_strategy: format!("{:?}", v.refresh_strategy),
                last_update,
                row_count: *v.row_count.read(),
                table_name: v.table_name.clone(),
            }
        })
        .collect();

    HttpResponse::Ok().json(StatusResponse {
        stream_buffer_rows: buffer_rows,
        parquet_partitions: partitions,
        materialized_views: view_infos,
        status: "running".to_string(),
    })
}

async fn create_view_handler(
    state: web::Data<AppState>,
    body: web::Json<CreateViewRequest>,
) -> HttpResponse {
    let strategy = match body.refresh_strategy.as_str() {
        "write_trigger" => {
            RefreshStrategy::WriteTrigger {
                debounce_secs: body.debounce_secs.unwrap_or(30),
            }
        }
        "periodic" => {
            RefreshStrategy::Periodic {
                interval_secs: body.interval_secs.unwrap_or(300),
            }
        }
        _ => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid refresh_strategy. Must be 'write_trigger' or 'periodic'"
            }));
        }
    };

    match state.view_manager.create_view(body.name.clone(), body.sql.clone(), strategy).await {
        Ok(view) => {
            HttpResponse::Ok().json(serde_json::json!({
                "status": "created",
                "name": view.name,
                "table_name": view.table_name,
                "row_count": view.row_count.read().clone()
            }))
        }
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({ "error": e })),
    }
}

async fn list_views_handler(state: web::Data<AppState>) -> HttpResponse {
    let views = state.view_manager.list_views();
    let view_infos: Vec<MaterializedViewInfo> = views
        .into_iter()
        .map(|v| {
            let last_update = v.last_update_micros.read().and_then(|micros| {
                chrono::DateTime::from_timestamp_micros(micros)
                    .map(|dt| dt.to_rfc3339())
            });
            MaterializedViewInfo {
                name: v.name.clone(),
                sql: v.sql.clone(),
                refresh_strategy: format!("{:?}", v.refresh_strategy),
                last_update,
                row_count: *v.row_count.read(),
                table_name: v.table_name.clone(),
            }
        })
        .collect();

    HttpResponse::Ok().json(serde_json::json!({ "views": view_infos }))
}

async fn drop_view_handler(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let name = path.into_inner();
    match state.view_manager.drop_view(&name).await {
        Ok(true) => HttpResponse::Ok().json(serde_json::json!({ "status": "dropped", "name": name })),
        Ok(false) => HttpResponse::NotFound().json(serde_json::json!({ "error": "View not found" })),
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({ "error": e })),
    }
}

async fn refresh_view_handler(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let name = path.into_inner();
    let Some(view) = state.view_manager.get_view(&name) else {
        return HttpResponse::NotFound().json(serde_json::json!({ "error": "View not found" }));
    };

    match state.view_manager.refresh_view(&view).await {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({
            "status": "refreshed",
            "name": name,
            "row_count": view.row_count.read().clone()
        })),
        Err(e) => HttpResponse::BadRequest().json(serde_json::json!({ "error": e })),
    }
}

async fn flush_handler(state: web::Data<AppState>) -> HttpResponse {
    if let Some(batch) = state.buffer.compact_and_drain() {
        let rows = batch.num_rows();
        match state.parquet_store.write_batch(&batch) {
            Ok(_) => HttpResponse::Ok().json(serde_json::json!({
                "status": "flushed",
                "rows": rows
            })),
            Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
                "error": e.to_string()
            })),
        }
    } else {
        HttpResponse::Ok().json(serde_json::json!({
            "status": "nothing_to_flush",
            "rows": 0
        }))
    }
}

fn arrow_value_to_json(col: &Arc<dyn arrow_array::Array>, row_idx: usize) -> serde_json::Value {
    if col.is_null(row_idx) {
        return serde_json::Value::Null;
    }

    match col.data_type() {
        arrow_schema::DataType::Timestamp(_, _) => {
            if let Some(ts) = col.as_any().downcast_ref::<arrow_array::TimestampMicrosecondArray>() {
                let micros = ts.value(row_idx);
                if let Some(dt) = chrono::DateTime::from_timestamp_micros(micros) {
                    return serde_json::Value::String(dt.to_rfc3339());
                }
            }
            serde_json::Value::Null
        }
        arrow_schema::DataType::Float64 => {
            if let Some(arr) = col.as_any().downcast_ref::<arrow_array::Float64Array>() {
                serde_json::Value::Number(serde_json::Number::from_f64(arr.value(row_idx))
                    .unwrap_or(serde_json::Number::from(0)))
            } else {
                serde_json::Value::Null
            }
        }
        arrow_schema::DataType::Float32 => {
            if let Some(arr) = col.as_any().downcast_ref::<arrow_array::Float32Array>() {
                serde_json::Value::Number(serde_json::Number::from_f64(arr.value(row_idx) as f64)
                    .unwrap_or(serde_json::Number::from(0)))
            } else {
                serde_json::Value::Null
            }
        }
        arrow_schema::DataType::Int64 => {
            if let Some(arr) = col.as_any().downcast_ref::<arrow_array::Int64Array>() {
                serde_json::json!(arr.value(row_idx))
            } else {
                serde_json::Value::Null
            }
        }
        arrow_schema::DataType::Int32 => {
            if let Some(arr) = col.as_any().downcast_ref::<arrow_array::Int32Array>() {
                serde_json::json!(arr.value(row_idx))
            } else {
                serde_json::Value::Null
            }
        }
        arrow_schema::DataType::Utf8 => {
            if let Some(arr) = col.as_any().downcast_ref::<arrow_array::StringArray>() {
                serde_json::Value::String(arr.value(row_idx).to_string())
            } else {
                serde_json::Value::Null
            }
        }
        arrow_schema::DataType::Boolean => {
            if let Some(arr) = col.as_any().downcast_ref::<arrow_array::BooleanArray>() {
                serde_json::Value::Bool(arr.value(row_idx))
            } else {
                serde_json::Value::Null
            }
        }
        _ => serde_json::Value::String(format!("{:?}", col.data_type())),
    }
}

pub async fn run_server(
    buffer: Arc<StreamBuffer>,
    parquet_store: Arc<ParquetStore>,
    engine: Arc<QueryEngine>,
    view_manager: Arc<ViewManager>,
    port: u16,
) -> std::io::Result<()> {
    let app_state = AppState {
        buffer,
        parquet_store,
        engine,
        view_manager,
    };

    HttpServer::new(move || {
        let cors = Cors::default()
            .allow_any_origin()
            .allow_any_method()
            .allow_any_header()
            .max_age(3600);

        App::new()
            .wrap(cors)
            .wrap(middleware::Logger::default())
            .app_data(web::Data::new(app_state.clone()))
            .route("/api/ingest", web::post().to(ingest_handler))
            .route("/api/ingest/batch", web::post().to(ingest_batch_handler))
            .route("/api/query", web::post().to(query_handler))
            .route("/api/status", web::get().to(status_handler))
            .route("/api/flush", web::post().to(flush_handler))
            .route("/api/views", web::post().to(create_view_handler))
            .route("/api/views", web::get().to(list_views_handler))
            .route("/api/views/{name}", web::delete().to(drop_view_handler))
            .route("/api/views/{name}/refresh", web::post().to(refresh_view_handler))
            .service(actix_files::Files::new("/", "./static").index_file("index.html"))
    })
    .bind(format!("0.0.0.0:{}", port))?
    .run()
    .await
}

impl Clone for AppState {
    fn clone(&self) -> Self {
        Self {
            buffer: self.buffer.clone(),
            parquet_store: self.parquet_store.clone(),
            engine: self.engine.clone(),
            view_manager: self.view_manager.clone(),
        }
    }
}
