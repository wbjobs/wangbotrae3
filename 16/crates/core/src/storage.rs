use anyhow::Result;
use rusqlite::params;
use std::sync::Arc;
use tokio::sync::Mutex;
use crate::models::*;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    source_pid INTEGER NOT NULL,
    target_pid INTEGER NOT NULL,
    ipc_type TEXT NOT NULL,
    fd INTEGER NOT NULL,
    content BLOB NOT NULL,
    direction TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    has_overrun INTEGER NOT NULL DEFAULT 0,
    dropped_count INTEGER NOT NULL DEFAULT 0,
    parse_result TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_source_pid ON messages(source_pid);
CREATE INDEX IF NOT EXISTS idx_messages_target_pid ON messages(target_pid);
CREATE INDEX IF NOT EXISTS idx_messages_ipc_type ON messages(ipc_type);
"#;

#[derive(Clone)]
pub struct MessageStore {
    conn: Arc<Mutex<rusqlite::Connection>>,
    ring_buffer_size: usize,
}

impl MessageStore {
    pub fn new(ring_buffer_size: usize) -> Result<Self> {
        let conn = rusqlite::Connection::open_in_memory()?;
        conn.execute_batch(SCHEMA)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            ring_buffer_size,
        })
    }

    pub async fn insert(&self, msg: &IpcMessage) -> Result<()> {
        let conn = self.conn.clone();
        let msg = msg.clone();
        let ring_buffer_size = self.ring_buffer_size;
        tokio::task::spawn_blocking(move || {
            let conn = conn.blocking_lock();
            let parse_result_str = msg.parse_result.as_ref().map(|pr| serde_json::to_string(pr).ok()).flatten();
            conn.execute(
                "INSERT INTO messages (id, timestamp, source_pid, target_pid, ipc_type, fd, content, direction, captured_at, has_overrun, dropped_count, parse_result) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![
                    msg.id,
                    msg.timestamp,
                    msg.source_pid,
                    msg.target_pid,
                    serde_json::to_string(&msg.ipc_type)?,
                    msg.fd,
                    msg.content,
                    serde_json::to_string(&msg.direction)?,
                    msg.captured_at,
                    msg.has_overrun as i32,
                    msg.dropped_count as i64,
                    parse_result_str,
                ],
            )?;
            let count: i64 = conn.query_row("SELECT COUNT(*) FROM messages", [], |r| r.get(0))?;
            if count as usize > ring_buffer_size {
                let excess = count as usize - ring_buffer_size;
                conn.execute(
                    "DELETE FROM messages WHERE id IN (SELECT id FROM messages ORDER BY timestamp ASC LIMIT ?1)",
                    params![excess],
                )?;
            }
            Ok::<(), anyhow::Error>(())
        }).await??;
        Ok(())
    }

    pub async fn query(&self, filter: &MessageFilter) -> Result<Vec<IpcMessage>> {
        let conn = self.conn.clone();
        let filter = filter.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.blocking_lock();
            let mut sql = String::from("SELECT id, timestamp, source_pid, target_pid, ipc_type, fd, content, direction, captured_at, has_overrun, dropped_count, parse_result FROM messages WHERE 1=1");
            let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
            let mut param_idx = 1;

            if let Some(sp) = filter.source_pid {
                sql.push_str(&format!(" AND source_pid = ?{param_idx}"));
                param_values.push(Box::new(sp as i64));
                param_idx += 1;
            }
            if let Some(tp) = filter.target_pid {
                sql.push_str(&format!(" AND target_pid = ?{param_idx}"));
                param_values.push(Box::new(tp as i64));
                param_idx += 1;
            }
            if let Some(ref it) = filter.ipc_type {
                sql.push_str(&format!(" AND ipc_type = ?{param_idx}"));
                param_values.push(Box::new(serde_json::to_string(it)?));
                param_idx += 1;
            }
            if let Some(ts) = filter.time_start {
                sql.push_str(&format!(" AND timestamp >= ?{param_idx}"));
                param_values.push(Box::new(ts));
                param_idx += 1;
            }
            if let Some(te) = filter.time_end {
                sql.push_str(&format!(" AND timestamp <= ?{param_idx}"));
                param_values.push(Box::new(te));
                param_idx += 1;
            }
            if let Some(ref st) = filter.search_text {
                sql.push_str(&format!(" AND CAST(content AS TEXT) LIKE ?{param_idx}"));
                param_values.push(Box::new(format!("%{st}%")));
                param_idx += 1;
            }

            sql.push_str(" ORDER BY timestamp ASC");

            if let Some(limit) = filter.limit {
                sql.push_str(&format!(" LIMIT ?{param_idx}"));
                param_values.push(Box::new(limit as i64));
                param_idx += 1;
            }
            if let Some(offset) = filter.offset {
                sql.push_str(&format!(" OFFSET ?{param_idx}"));
                param_values.push(Box::new(offset as i64));
            }

            let params_refs: Vec<&dyn rusqlite::types::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();
            let mut stmt = conn.prepare(&sql)?;
            let messages = stmt.query_map(params_refs.as_slice(), |row| {
                let ipc_type_str: String = row.get(4)?;
                let direction_str: String = row.get(7)?;
                let has_overrun_int: i32 = row.get(9)?;
                let parse_result_str: Option<String> = row.get(11)?;
                let parse_result = parse_result_str.and_then(|s| serde_json::from_str::<ParseResult>(&s).ok());
                Ok(IpcMessage {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    source_pid: row.get(2)?,
                    target_pid: row.get(3)?,
                    ipc_type: serde_json::from_str(&ipc_type_str).unwrap_or(IpcType::UnixDomainSocket),
                    fd: row.get(5)?,
                    content: row.get(6)?,
                    direction: serde_json::from_str(&direction_str).unwrap_or(MessageDirection::Send),
                    captured_at: row.get(8)?,
                    has_overrun: has_overrun_int != 0,
                    dropped_count: row.get::<_, i64>(10)? as u64,
                    parse_result,
                })
            })?.collect::<Result<Vec<_>, _>>()?;
            Ok(messages)
        }).await?
    }

    pub async fn get_by_id(&self, id: &str) -> Result<Option<IpcMessage>> {
        let conn = self.conn.clone();
        let id = id.to_string();
        tokio::task::spawn_blocking(move || {
            let conn = conn.blocking_lock();
            let mut stmt = conn.prepare("SELECT id, timestamp, source_pid, target_pid, ipc_type, fd, content, direction, captured_at, has_overrun, dropped_count FROM messages WHERE id = ?1")?;
            let mut messages = stmt.query_map(params![id], |row| {
                let ipc_type_str: String = row.get(4)?;
                let direction_str: String = row.get(7)?;
                let has_overrun_int: i32 = row.get(9)?;
                Ok(IpcMessage {
                    id: row.get(0)?,
                    timestamp: row.get(1)?,
                    source_pid: row.get(2)?,
                    target_pid: row.get(3)?,
                    ipc_type: serde_json::from_str(&ipc_type_str).unwrap_or(IpcType::UnixDomainSocket),
                    fd: row.get(5)?,
                    content: row.get(6)?,
                    direction: serde_json::from_str(&direction_str).unwrap_or(MessageDirection::Send),
                    captured_at: row.get(8)?,
                    has_overrun: has_overrun_int != 0,
                    dropped_count: row.get::<_, i64>(10)? as u64,
                })
            })?;
            match messages.next() {
                Some(m) => Ok(Some(m?)),
                None => Ok(None),
            }
        }).await?
    }

    pub async fn get_process_tree(&self) -> Result<ProcessTree> {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let conn = conn.blocking_lock();
            let mut stmt = conn.prepare(
                "SELECT DISTINCT source_pid, target_pid, ipc_type, fd, COUNT(*) as cnt FROM messages GROUP BY source_pid, target_pid, ipc_type, fd"
            )?;
            let mut pid_map: std::collections::HashMap<u32, Vec<ProcessConnection>> = std::collections::HashMap::new();
            let rows = stmt.query_map([], |row| {
                let ipc_type_str: String = row.get(2)?;
                Ok((
                    row.get::<_, u32>(0)?,
                    row.get::<_, u32>(1)?,
                    ipc_type_str,
                    row.get::<_, u32>(3)?,
                    row.get::<_, u64>(4)?,
                ))
            })?;
            for row in rows {
                let (src, tgt, it_str, fd, cnt) = row?;
                let ipc_type: IpcType = serde_json::from_str(&it_str).unwrap_or(IpcType::UnixDomainSocket);
                pid_map.entry(src).or_default().push(ProcessConnection {
                    remote_pid: tgt,
                    ipc_type: ipc_type.clone(),
                    fd,
                    message_count: cnt,
                });
                pid_map.entry(tgt).or_default();
            }
            let nodes = pid_map.into_iter().map(|(pid, connections)| ProcessNode {
                pid,
                name: format!("process-{pid}"),
                cmdline: String::new(),
                connections,
            }).collect();
            Ok(ProcessTree { nodes })
        }).await?
    }

    pub async fn get_messages_for_replay(&self, filter: &MessageFilter) -> Result<Vec<IpcMessage>> {
        self.query(filter).await
    }
}
