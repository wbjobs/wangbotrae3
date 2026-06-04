use arrow_array::RecordBatch;
use datafusion::error::Result as DFResult;
use datafusion::prelude::SessionContext;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

use crate::schema::schema;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RefreshStrategy {
    WriteTrigger { debounce_secs: u64 },
    Periodic { interval_secs: u64 },
}

#[derive(Debug, Clone)]
pub struct MaterializedView {
    pub name: String,
    pub sql: String,
    pub refresh_strategy: RefreshStrategy,
    pub last_update_micros: Arc<RwLock<Option<i64>>>,
    pub last_refresh_attempt_micros: Arc<RwLock<Option<i64>>>,
    pub pending_refresh: Arc<RwLock<bool>>,
    pub table_name: String,
    pub row_count: Arc<RwLock<usize>>,
}

impl MaterializedView {
    pub fn new(name: String, sql: String, strategy: RefreshStrategy) -> Self {
        let table_name = format!("mv_{}", name);
        Self {
            name,
            sql,
            refresh_strategy: strategy,
            last_update_micros: Arc::new(RwLock::new(None)),
            last_refresh_attempt_micros: Arc::new(RwLock::new(None)),
            pending_refresh: Arc::new(RwLock::new(true)),
            table_name,
            row_count: Arc::new(RwLock::new(0)),
        }
    }
}

pub struct ViewManager {
    views: Arc<RwLock<HashMap<String, Arc<MaterializedView>>>>,
    ctx: Arc<RwLock<Option<Arc<SessionContext>>>>,
}

impl ViewManager {
    pub fn new() -> Self {
        Self {
            views: Arc::new(RwLock::new(HashMap::new())),
            ctx: Arc::new(RwLock::new(None)),
        }
    }

    pub fn set_ctx(&self, ctx: Arc<SessionContext>) {
        *self.ctx.write() = Some(ctx);
    }

    fn get_ctx(&self) -> Option<Arc<SessionContext>> {
        self.ctx.read().as_ref().cloned()
    }

    pub async fn create_view(
        &self,
        name: String,
        sql: String,
        strategy: RefreshStrategy,
    ) -> Result<Arc<MaterializedView>, String> {
        let ctx = self.get_ctx().ok_or("SessionContext not set")?;

        let table_name = format!("mv_{}", name);

        {
            let mut views = self.views.write();
            if views.contains_key(&name) {
                return Err(format!("View '{}' already exists", name));
            }
        }

        let empty_mem = datafusion::datasource::MemTable::try_new(
            schema(),
            vec![vec![]],
        )
        .map_err(|e| e.to_string())?;

        ctx.register_table(&table_name, Arc::new(empty_mem))
            .map_err(|e| e.to_string())?;

        let view = Arc::new(MaterializedView::new(name.clone(), sql, strategy));
        self.views.write().insert(name, view.clone());

        self.refresh_view(&view).await?;
        Ok(view)
    }

    pub async fn drop_view(&self, name: &str) -> Result<bool, String> {
        let ctx = self.get_ctx().ok_or("SessionContext not set")?;
        let table_name = format!("mv_{}", name);
        let removed = self.views.write().remove(name).is_some();
        if removed {
            let _ = ctx.deregister_table(&table_name);
        }
        Ok(removed)
    }

    pub fn get_view(&self, name: &str) -> Option<Arc<MaterializedView>> {
        self.views.read().get(name).cloned()
    }

    pub fn list_views(&self) -> Vec<Arc<MaterializedView>> {
        self.views.read().values().cloned().collect()
    }

    pub fn mark_write_triggered(&self) {
        let views = self.views.read();
        for view in views.values() {
            if let RefreshStrategy::WriteTrigger { .. } = view.refresh_strategy {
                *view.pending_refresh.write() = true;
            }
        }
    }

    pub fn get_due_views(&self, now_micros: i64) -> Vec<Arc<MaterializedView>> {
        let mut due = Vec::new();
        let views = self.views.read();
        for view in views.values() {
            let should_refresh = match &view.refresh_strategy {
                RefreshStrategy::WriteTrigger { debounce_secs } => {
                    if *view.pending_refresh.read() {
                        let last_attempt = view.last_refresh_attempt_micros.read().unwrap_or(0);
                        let debounce_micros = (*debounce_secs as i64) * 1_000_000;
                        now_micros - last_attempt >= debounce_micros
                    } else {
                        false
                    }
                }
                RefreshStrategy::Periodic { interval_secs } => {
                    let last_update = view.last_update_micros.read().unwrap_or(0);
                    let interval_micros = (*interval_secs as i64) * 1_000_000;
                    now_micros - last_update >= interval_micros
                }
            };
            if should_refresh {
                due.push(view.clone());
            }
        }
        due
    }

    pub async fn refresh_view(&self, view: &MaterializedView) -> Result<(), String> {
        let ctx = self.get_ctx().ok_or("SessionContext not set")?;
        let now = chrono::Utc::now().timestamp_micros();
        *view.last_refresh_attempt_micros.write() = Some(now);

        let df = ctx.sql(&view.sql).await.map_err(|e| e.to_string())?;
        let batches = df.collect().await.map_err(|e| e.to_string())?;

        let total_rows: usize = batches.iter().map(|b| b.num_rows()).sum();

        let result_schema = if batches.is_empty() {
            schema()
        } else {
            batches[0].schema()
        };

        let mem_table = if batches.is_empty() {
            datafusion::datasource::MemTable::try_new(result_schema, vec![vec![]])
        } else {
            datafusion::datasource::MemTable::try_new(result_schema, vec![batches])
        }
        .map_err(|e| e.to_string())?;

        let _ = ctx.deregister_table(&view.table_name);
        ctx.register_table(&view.table_name, Arc::new(mem_table))
            .map_err(|e| e.to_string())?;

        *view.pending_refresh.write() = false;
        *view.last_update_micros.write() = Some(chrono::Utc::now().timestamp_micros());
        *view.row_count.write() = total_rows;

        Ok(())
    }

    pub async fn refresh_all_due(&self) -> Vec<(String, Result<(), String>)> {
        let now = chrono::Utc::now().timestamp_micros();
        let due = self.get_due_views(now);
        let mut results = Vec::new();
        for view in due {
            let name = view.name.clone();
            let res = self.refresh_view(&view).await;
            results.push((name, res));
        }
        results
    }
}

pub fn register_view_tables(
    ctx: &SessionContext,
    view_manager: &ViewManager,
) -> DFResult<()> {
    for view in view_manager.list_views() {
        let mem = datafusion::datasource::MemTable::try_new(
            schema(),
            vec![vec![]],
        )?;
        ctx.register_table(&view.table_name, Arc::new(mem))?;
    }
    Ok(())
}
