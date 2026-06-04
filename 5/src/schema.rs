use arrow::datatypes::{DataType, Field, Schema, TimeUnit};
use std::sync::Arc;

pub fn schema() -> Arc<Schema> {
    Arc::new(Schema::new(vec![
        Field::new("timestamp", DataType::Timestamp(TimeUnit::Microsecond, Some("+00:00".into())), false),
        Field::new("device_id", DataType::Utf8, false),
        Field::new("temperature", DataType::Float64, true),
        Field::new("humidity", DataType::Float64, true),
        Field::new("vibration", DataType::Float64, true),
        Field::new("pressure", DataType::Float64, true),
        Field::new("location", DataType::Utf8, true),
    ]))
}
