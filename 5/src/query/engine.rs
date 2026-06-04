use arrow_array::RecordBatch;
use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use datafusion::catalog::{Session, TableProvider};
use datafusion::datasource::MemTable;
use datafusion::error::Result as DFResult;
use datafusion::logical_expr::{BinaryExpr, Expr, Operator, TableProviderFilterPushDown, TableType};
use datafusion::physical_plan::ExecutionPlan;
use datafusion::prelude::SessionContext;
use datafusion::scalar::ScalarValue;
use parking_lot::RwLock;
use std::any::Any;
use std::collections::HashSet;
use std::fmt;
use std::sync::Arc;

use crate::schema::schema;
use crate::storage::buffer::StreamBuffer;
use crate::storage::parquet_store::ParquetStore;

struct CachedParquetData {
    known_files: HashSet<String>,
    batches: Vec<RecordBatch>,
}

pub struct UnifiedTableProvider {
    table_schema: Arc<arrow_schema::Schema>,
    buffer: Arc<StreamBuffer>,
    parquet_store: Arc<ParquetStore>,
    cache: RwLock<CachedParquetData>,
}

impl fmt::Debug for UnifiedTableProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("UnifiedTableProvider").finish()
    }
}

struct TimeRange {
    start_micros: Option<i64>,
    end_micros: Option<i64>,
}

fn extract_timestamp_micros(value: &ScalarValue) -> Option<i64> {
    match value {
        ScalarValue::TimestampMicrosecond(Some(v), _) => Some(*v),
        ScalarValue::Utf8(Some(s)) => {
            if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
                Some(dt.timestamp_micros())
            } else if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S") {
                let utc: DateTime<Utc> = Utc.from_utc_datetime(&dt);
                Some(utc.timestamp_micros())
            } else if let Ok(d) = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d") {
                let utc: DateTime<Utc> = Utc.from_utc_datetime(&d.and_hms_opt(0, 0, 0)?);
                Some(utc.timestamp_micros())
            } else {
                None
            }
        }
        ScalarValue::TimestampSecond(Some(v), _) => Some(*v * 1_000_000),
        ScalarValue::TimestampMillisecond(Some(v), _) => Some(*v * 1_000),
        ScalarValue::TimestampNanosecond(Some(v), _) => Some(*v / 1_000),
        _ => None,
    }
}

fn is_timestamp_column(expr: &Expr) -> bool {
    match expr {
        Expr::Column(col) => col.name() == "timestamp",
        _ => false,
    }
}

fn swap_op(op: Operator, is_col_left: bool) -> Operator {
    if is_col_left {
        op
    } else {
        op.swap().unwrap_or(op)
    }
}

fn extract_range_from_expr(expr: &Expr, range: &mut TimeRange) {
    match expr {
        Expr::BinaryExpr(BinaryExpr { left, op, right }) => {
            let is_col_left = is_timestamp_column(left);
            let is_col_right = is_timestamp_column(right);
            if !is_col_left && !is_col_right {
                return;
            }

            let val_expr = if is_col_left { right.as_ref() } else { left.as_ref() };
            let ts_value = match val_expr {
                Expr::Literal(scalar) => extract_timestamp_micros(scalar),
                _ => None,
            };

            let Some(ts) = ts_value else {
                return;
            };

            let effective_op = swap_op(*op, is_col_left);

            match effective_op {
                Operator::Gt => {
                    range.start_micros = Some(match range.start_micros {
                        Some(s) => s.max(ts + 1),
                        None => ts + 1,
                    });
                }
                Operator::GtEq => {
                    range.start_micros = Some(match range.start_micros {
                        Some(s) => s.max(ts),
                        None => ts,
                    });
                }
                Operator::Lt => {
                    range.end_micros = Some(match range.end_micros {
                        Some(e) => e.min(ts),
                        None => ts,
                    });
                }
                Operator::LtEq => {
                    range.end_micros = Some(match range.end_micros {
                        Some(e) => e.min(ts + 1),
                        None => ts + 1,
                    });
                }
                Operator::Eq => {
                    range.start_micros = Some(match range.start_micros {
                        Some(s) => s.max(ts),
                        None => ts,
                    });
                    range.end_micros = Some(match range.end_micros {
                        Some(e) => e.min(ts + 1),
                        None => ts + 1,
                    });
                }
                _ => {}
            }
        }
        Expr::Between(between) => {
            if between.negated || !is_timestamp_column(&between.expr) {
                return;
            }
            if let Expr::Literal(low_scalar) = between.low.as_ref() {
                if let Some(ts) = extract_timestamp_micros(low_scalar) {
                    range.start_micros = Some(match range.start_micros {
                        Some(s) => s.max(ts),
                        None => ts,
                    });
                }
            }
            if let Expr::Literal(high_scalar) = between.high.as_ref() {
                if let Some(ts) = extract_timestamp_micros(high_scalar) {
                    range.end_micros = Some(match range.end_micros {
                        Some(e) => e.min(ts + 1),
                        None => ts + 1,
                    });
                }
            }
        }
        _ => {}
    }
}

fn extract_time_range_from_filters(filters: &[Expr]) -> TimeRange {
    let mut range = TimeRange {
        start_micros: None,
        end_micros: None,
    };

    for expr in filters {
        extract_range_from_expr(expr, &mut range);
    }

    range
}

impl UnifiedTableProvider {
    pub fn new(
        buffer: Arc<StreamBuffer>,
        parquet_store: Arc<ParquetStore>,
    ) -> Self {
        Self {
            table_schema: schema(),
            buffer,
            parquet_store,
            cache: RwLock::new(CachedParquetData {
                known_files: HashSet::new(),
                batches: Vec::new(),
            }),
        }
    }

    fn collect_batches_with_pruning(
        &self,
        time_range: &TimeRange,
    ) -> Vec<RecordBatch> {
        let mut all_batches = Vec::new();

        let parquet_batches = if time_range.start_micros.is_some() || time_range.end_micros.is_some() {
            self.parquet_store
                .read_partitions_in_range(time_range.start_micros, time_range.end_micros)
                .unwrap_or_default()
        } else {
            let cached = self.cache.read();
            if !cached.batches.is_empty() && !cached.known_files.is_empty() {
                cached.batches.iter().cloned().collect()
            } else {
                self.parquet_store.read_all().unwrap_or_default()
            }
        };
        all_batches.extend(parquet_batches);

        let stream_batches = self.buffer.snapshot();
        if time_range.start_micros.is_some() || time_range.end_micros.is_some() {
            let filtered = self.filter_batches_by_time(stream_batches, time_range);
            all_batches.extend(filtered);
        } else {
            all_batches.extend(stream_batches);
        }

        all_batches
    }

    fn filter_batches_by_time(
        &self,
        batches: Vec<RecordBatch>,
        range: &TimeRange,
    ) -> Vec<RecordBatch> {
        batches
            .into_iter()
            .filter_map(|batch| {
                let ts_col = batch.column_by_name("timestamp")?;
                let ts_array = ts_col
                    .as_any()
                    .downcast_ref::<arrow_array::TimestampMicrosecondArray>()?;

                let n = batch.num_rows();
                let mut mask_vals = vec![true; n];

                for i in 0..n {
                    let v = ts_array.value(i);
                    if let Some(start) = range.start_micros {
                        if v < start {
                            mask_vals[i] = false;
                        }
                    }
                    if let Some(end) = range.end_micros {
                        if v >= end {
                            mask_vals[i] = false;
                        }
                    }
                }

                let mask = arrow_array::BooleanArray::from(mask_vals);
                arrow::compute::filter_record_batch(&batch, &mask).ok()
            })
            .collect()
    }

    pub fn refresh_parquet_cache_if_needed(&self) {
        let current_files = self.parquet_store.list_parquet_files();
        let needs_refresh = {
            let cached = self.cache.read();
            current_files.len() != cached.known_files.len()
                || !current_files.iter().all(|f| cached.known_files.contains(f))
        };

        if needs_refresh {
            if let Ok(batches) = self.parquet_store.read_all() {
                let mut cache = self.cache.write();
                cache.known_files = current_files.into_iter().collect();
                cache.batches = batches;
            }
        }
    }
}

#[async_trait]
impl TableProvider for UnifiedTableProvider {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> Arc<arrow_schema::Schema> {
        self.table_schema.clone()
    }

    fn table_type(&self) -> TableType {
        TableType::Base
    }

    fn supports_filters_pushdown(
        &self,
        _filters: &[&Expr],
    ) -> DFResult<Vec<TableProviderFilterPushDown>> {
        Ok(vec![TableProviderFilterPushDown::Inexact; _filters.len()])
    }

    async fn scan(
        &self,
        state: &dyn Session,
        projection: Option<&Vec<usize>>,
        filters: &[Expr],
        limit: Option<usize>,
    ) -> DFResult<Arc<dyn ExecutionPlan>> {
        self.refresh_parquet_cache_if_needed();

        let time_range = extract_time_range_from_filters(filters);
        let batches = self.collect_batches_with_pruning(&time_range);

        let mem_table = if batches.is_empty() {
            MemTable::try_new(self.table_schema.clone(), vec![vec![]])?
        } else {
            MemTable::try_new(self.table_schema.clone(), vec![batches])?
        };

        mem_table.scan(state, projection, filters, limit).await
    }
}

pub struct QueryEngine {
    ctx: Arc<SessionContext>,
    provider: Arc<UnifiedTableProvider>,
}

impl QueryEngine {
    pub fn new(
        buffer: Arc<StreamBuffer>,
        parquet_store: Arc<ParquetStore>,
        view_manager: Arc<crate::query::views::ViewManager>,
    ) -> Self {
        let ctx = Arc::new(SessionContext::new());

        let provider = Arc::new(UnifiedTableProvider::new(buffer, parquet_store));
        ctx.register_table("sensor_data", provider.clone())
            .expect("failed to register table");

        view_manager.set_ctx(ctx.clone());

        Self { ctx, provider }
    }

    pub async fn execute_sql(&self, sql: &str) -> datafusion::error::Result<Vec<RecordBatch>> {
        self.provider.refresh_parquet_cache_if_needed();
        let df = self.ctx.sql(sql).await?;
        df.collect().await
    }

    pub fn ctx(&self) -> Arc<SessionContext> {
        self.ctx.clone()
    }
}
