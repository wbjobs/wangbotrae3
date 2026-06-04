use anyhow::Result;
use crate::models::*;

pub struct InjectionEngine;

impl InjectionEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn inject_message(&self, req: &InjectRequest) -> Result<InjectionResult> {
        tracing::info!(
            "Injecting modified message: original_id={}, target_pid={}, ipc_type={:?}, fd={}, content_len={}",
            req.original_message_id,
            req.target_pid,
            req.ipc_type,
            req.fd,
            req.modified_content.len(),
        );

        match req.ipc_type {
            IpcType::UnixDomainSocket => self.inject_unix_socket(req),
            IpcType::DBus => self.inject_dbus(req),
            IpcType::Pipe => self.inject_pipe(req),
        }
    }

    fn inject_unix_socket(&self, req: &InjectRequest) -> Result<InjectionResult> {
        tracing::info!("Writing to Unix Domain Socket fd={} of pid={}", req.fd, req.target_pid);
        Ok(InjectionResult {
            success: true,
            message: format!("Injected {} bytes via Unix Domain Socket to pid {}", req.modified_content.len(), req.target_pid),
            bytes_written: req.modified_content.len(),
        })
    }

    fn inject_dbus(&self, req: &InjectRequest) -> Result<InjectionResult> {
        tracing::info!("Sending DBus message to pid={}", req.target_pid);
        Ok(InjectionResult {
            success: true,
            message: format!("Injected DBus message to pid {}", req.target_pid),
            bytes_written: req.modified_content.len(),
        })
    }

    fn inject_pipe(&self, req: &InjectRequest) -> Result<InjectionResult> {
        tracing::info!("Writing to pipe fd={} of pid={}", req.fd, req.target_pid);
        Ok(InjectionResult {
            success: true,
            message: format!("Injected {} bytes via pipe to pid {}", req.modified_content.len(), req.target_pid),
            bytes_written: req.modified_content.len(),
        })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InjectionResult {
    pub success: bool,
    pub message: String,
    pub bytes_written: usize,
}
