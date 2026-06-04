use arrow_array::{Float64Array, RecordBatch, StringArray, TimestampMicrosecondArray};
use chrono::Utc;
use rand::Rng;
use std::sync::Arc;

use crate::schema::schema;

pub fn generate_batch(device_count: usize, rows_per_device: usize) -> RecordBatch {
    let total = device_count * rows_per_device;
    let mut timestamps = Vec::with_capacity(total);
    let mut device_ids = Vec::with_capacity(total);
    let mut temperatures = Vec::with_capacity(total);
    let mut humidities = Vec::with_capacity(total);
    let mut vibrations = Vec::with_capacity(total);
    let mut pressures = Vec::with_capacity(total);
    let mut locations = Vec::with_capacity(total);

    let now = Utc::now().timestamp_micros();
    let mut rng = rand::thread_rng();
    let location_names = ["factory_a", "factory_b", "warehouse_c", "lab_d", "office_e"];

    for d in 0..device_count {
        let device_id = format!("DEV_{:04}", d);
        let location = location_names[d % location_names.len()];
        for r in 0..rows_per_device {
            let ts = now - (r as i64 * 1_000);
            timestamps.push(ts);
            device_ids.push(device_id.clone());
            temperatures.push(Some(20.0 + rng.gen_range(-5.0..15.0)));
            humidities.push(Some(50.0 + rng.gen_range(-20.0..30.0)));
            vibrations.push(Some(rng.gen_range(0.0..10.0)));
            pressures.push(Some(1013.0 + rng.gen_range(-10.0..10.0)));
            locations.push(location);
        }
    }

    let schema = schema();
    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(TimestampMicrosecondArray::from(timestamps).with_timezone_utc()),
            Arc::new(StringArray::from(device_ids)),
            Arc::new(Float64Array::from(temperatures)),
            Arc::new(Float64Array::from(humidities)),
            Arc::new(Float64Array::from(vibrations)),
            Arc::new(Float64Array::from(pressures)),
            Arc::new(StringArray::from(locations)),
        ],
    )
    .unwrap()
}

pub fn generate_single(device_id: &str, location: &str) -> RecordBatch {
    let mut rng = rand::thread_rng();
    let now = Utc::now().timestamp_micros();

    let schema = schema();
    RecordBatch::try_new(
        schema,
        vec![
            Arc::new(TimestampMicrosecondArray::from(vec![now]).with_timezone_utc()),
            Arc::new(StringArray::from(vec![device_id])),
            Arc::new(Float64Array::from(vec![Some(20.0 + rng.gen_range(-5.0..15.0))])),
            Arc::new(Float64Array::from(vec![Some(50.0 + rng.gen_range(-20.0..30.0))])),
            Arc::new(Float64Array::from(vec![Some(rng.gen_range(0.0..10.0))])),
            Arc::new(Float64Array::from(vec![Some(1013.0 + rng.gen_range(-10.0..10.0))])),
            Arc::new(StringArray::from(vec![location])),
        ],
    )
    .unwrap()
}
