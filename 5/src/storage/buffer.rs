use arrow_array::RecordBatch;
use chrono::Utc;
use parking_lot::RwLock;
use std::sync::Arc;

use crate::schema::schema;

const BUFFER_FLUSH_INTERVAL_SECS: i64 = 300;

pub struct StreamBuffer {
    schema: Arc<arrow_schema::Schema>,
    batches: RwLock<Vec<RecordBatch>>,
    earliest_ts: RwLock<Option<i64>>,
}

impl StreamBuffer {
    pub fn new() -> Self {
        Self {
            schema: schema(),
            batches: RwLock::new(Vec::new()),
            earliest_ts: RwLock::new(None),
        }
    }

    pub fn append(&self, batch: RecordBatch) {
        let mut batches = self.batches.write();
        let mut earliest = self.earliest_ts.write();

        if let Some(ts_col) = batch.column_by_name("timestamp") {
            if let Some(ts_array) = ts_col.as_any().downcast_ref::<arrow_array::TimestampMicrosecondArray>() {
                if ts_array.len() > 0 {
                    let min_ts = ts_array.value(0);
                    match *earliest {
                        None => *earliest = Some(min_ts),
                        Some(current) if min_ts < current => *earliest = Some(min_ts),
                        _ => {}
                    }
                }
            }
        }

        batches.push(batch);
    }

    pub fn snapshot(&self) -> Vec<RecordBatch> {
        self.batches.read().clone()
    }

    pub fn should_flush(&self) -> bool {
        let earliest = self.earliest_ts.read();
        match *earliest {
            Some(ts) => {
                let now = Utc::now().timestamp_micros();
                let age_secs = (now - ts) / 1_000_000;
                age_secs >= BUFFER_FLUSH_INTERVAL_SECS
            }
            None => false,
        }
    }

    pub fn drain(&self) -> Vec<RecordBatch> {
        let mut batches = self.batches.write();
        let mut earliest = self.earliest_ts.write();
        *earliest = None;
        std::mem::take(&mut *batches)
    }

    pub fn row_count(&self) -> usize {
        self.batches.read().iter().map(|b| b.num_rows()).sum()
    }

    pub fn schema(&self) -> Arc<arrow_schema::Schema> {
        self.schema.clone()
    }

    pub fn compact_and_drain(&self) -> Option<RecordBatch> {
        let batches = self.drain();
        if batches.is_empty() {
            return None;
        }

        let schema = self.schema.clone();
        let mut all_batches = Vec::new();
        for b in batches {
            if b.num_rows() > 0 {
                all_batches.push(b);
            }
        }

        if all_batches.is_empty() {
            return None;
        }

        if all_batches.len() == 1 {
            return Some(all_batches.into_iter().next().unwrap());
        }

        let combined = arrow::compute::concat_batches(&schema, &all_batches).ok()?;
        Some(combined)
    }
}
