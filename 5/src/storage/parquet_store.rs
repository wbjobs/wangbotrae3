use arrow_array::{Int64Array, RecordBatch, TimestampMicrosecondArray};
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
use parquet::arrow::ArrowWriter;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

pub struct ParquetStore {
    base_dir: PathBuf,
}

#[derive(Debug, Clone)]
pub struct PartitionRange {
    pub date_str: String,
    pub start_micros: i64,
    pub end_micros: i64,
}

impl ParquetStore {
    pub fn new(base_dir: impl AsRef<Path>) -> Self {
        let base_dir = base_dir.as_ref().to_path_buf();
        fs::create_dir_all(&base_dir).ok();
        Self { base_dir }
    }

    fn micros_to_date_key(micros: i64) -> String {
        DateTime::from_timestamp_micros(micros)
            .unwrap_or_else(|| Utc::now())
            .format("%Y-%m-%d")
            .to_string()
    }

    fn date_key_to_range(date_str: &str) -> Option<PartitionRange> {
        let naive = NaiveDate::parse_from_str(date_str, "%Y-%m-%d").ok()?;
        let start: DateTime<Utc> = Utc.from_utc_datetime(&naive.and_hms_opt(0, 0, 0)?);
        let end = start + chrono::Duration::days(1);
        Some(PartitionRange {
            date_str: date_str.to_string(),
            start_micros: start.timestamp_micros(),
            end_micros: end.timestamp_micros(),
        })
    }

    pub fn write_batch(&self, batch: &RecordBatch) -> Result<(), String> {
        if batch.num_rows() == 0 {
            return Ok(());
        }

        let ts_col = batch
            .column_by_name("timestamp")
            .ok_or("missing timestamp column")?;
        let ts_array = ts_col
            .as_any()
            .downcast_ref::<TimestampMicrosecondArray>()
            .ok_or("timestamp column type mismatch")?;

        let split_batches = self.split_by_date(ts_array, batch)?;

        for (date_key, sub_batch) in split_batches {
            self.write_partition_batch(&date_key, &sub_batch)?;
        }

        Ok(())
    }

    fn split_by_date(
        &self,
        ts_array: &TimestampMicrosecondArray,
        batch: &RecordBatch,
    ) -> Result<Vec<(String, RecordBatch)>, String> {
        let n = ts_array.len();
        if n == 0 {
            return Ok(Vec::new());
        }

        let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for i in 0..n {
            let date_key = Self::micros_to_date_key(ts_array.value(i));
            groups.entry(date_key).or_default().push(i);
        }

        let schema = batch.schema();
        let mut result = Vec::new();

        for (date_key, indices) in groups {
            if indices.is_empty() {
                continue;
            }

            let indices_array = Int64Array::from(indices.iter().map(|&i| i as i64).collect::<Vec<_>>());
            let take_indices = arrow::compute::cast(&indices_array, &arrow_schema::DataType::UInt32)
                .map_err(|e| e.to_string())?;

            let mut sub_cols = Vec::new();
            for col_idx in 0..batch.num_columns() {
                let col = batch.column(col_idx);
                let taken = arrow::compute::take(col, &take_indices, None)
                    .map_err(|e| e.to_string())?;
                sub_cols.push(taken);
            }

            let sub_batch = RecordBatch::try_new(schema.clone(), sub_cols)
                .map_err(|e| e.to_string())?;
            result.push((date_key, sub_batch));
        }

        Ok(result)
    }

    fn write_partition_batch(
        &self,
        date_key: &str,
        batch: &RecordBatch,
    ) -> Result<(), String> {
        let partition_dir = self.base_dir.join(date_key);
        fs::create_dir_all(&partition_dir).map_err(|e| e.to_string())?;

        let file_name = format!(
            "data_{}.parquet",
            Utc::now().format("%Y%m%d%H%M%S%3f")
        );
        let file_path = partition_dir.join(&file_name);

        let file = fs::File::create(&file_path).map_err(|e| e.to_string())?;
        let schema = batch.schema();
        let mut writer = ArrowWriter::try_new(file, schema, None)
            .map_err(|e| e.to_string())?;
        writer.write(batch).map_err(|e| e.to_string())?;
        writer.close().map_err(|e| e.to_string())?;

        Ok(())
    }

    pub fn read_partitions_in_range(
        &self,
        range_start_micros: Option<i64>,
        range_end_micros: Option<i64>,
    ) -> Result<Vec<RecordBatch>, String> {
        let partitions = self.list_partitions();
        let mut batches = Vec::new();

        for date_str in &partitions {
            if let Some(pr) = Self::date_key_to_range(date_str) {
                if let Some(start) = range_start_micros {
                    if pr.end_micros <= start {
                        continue;
                    }
                }
                if let Some(end) = range_end_micros {
                    if pr.start_micros >= end {
                        continue;
                    }
                }
            }

            let partition_batches = self.read_partition(date_str)?;
            batches.extend(partition_batches);
        }

        Ok(batches)
    }

    pub fn read_partition(&self, date: &str) -> Result<Vec<RecordBatch>, String> {
        let partition_dir = self.base_dir.join(date);
        self.read_dir(&partition_dir)
    }

    pub fn read_all(&self) -> Result<Vec<RecordBatch>, String> {
        self.read_dir(&self.base_dir)
    }

    fn read_dir(&self, dir: &Path) -> Result<Vec<RecordBatch>, String> {
        let mut batches = Vec::new();

        if !dir.exists() {
            return Ok(batches);
        }

        let entries: Vec<PathBuf> = fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .collect();

        for entry in entries {
            if entry.is_dir() {
                let sub_batches = self.read_dir(&entry)?;
                batches.extend(sub_batches);
            } else if entry.extension().map(|e| e == "parquet").unwrap_or(false) {
                let file = fs::File::open(&entry).map_err(|e| e.to_string())?;
                let builder = ParquetRecordBatchReaderBuilder::try_new(file)
                    .map_err(|e| e.to_string())?;
                let reader = builder.build().map_err(|e| e.to_string())?;
                for batch_result in reader {
                    let batch = batch_result.map_err(|e| e.to_string())?;
                    batches.push(batch);
                }
            }
        }

        Ok(batches)
    }

    pub fn list_partitions(&self) -> Vec<String> {
        let mut partitions = Vec::new();
        if !self.base_dir.exists() {
            return partitions;
        }

        if let Ok(entries) = fs::read_dir(&self.base_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(name) = path.file_name() {
                        let name_str = name.to_string_lossy().to_string();
                        if name_str.contains('-') && name_str.len() == 10 {
                            partitions.push(name_str);
                        }
                    }
                }
            }
        }

        partitions.sort();
        partitions
    }

    pub fn list_parquet_files(&self) -> Vec<String> {
        let mut files = Vec::new();
        self.collect_parquet_paths(&self.base_dir, &mut files);
        files.sort();
        files
    }

    fn collect_parquet_paths(&self, dir: &Path, files: &mut Vec<String>) {
        if !dir.exists() {
            return;
        }

        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    self.collect_parquet_paths(&path, files);
                } else if path.extension().map(|e| e == "parquet").unwrap_or(false) {
                    if let Some(p) = path.to_str() {
                        files.push(p.to_string());
                    }
                }
            }
        }
    }

    pub fn get_partition_ranges(&self) -> Vec<PartitionRange> {
        self.list_partitions()
            .iter()
            .filter_map(|d| Self::date_key_to_range(d))
            .collect()
    }
}
