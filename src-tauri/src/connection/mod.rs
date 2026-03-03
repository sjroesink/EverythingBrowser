pub mod config;

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::connection::config::ConnectionConfig;
use crate::credentials::CredentialStore;
use crate::error::AppError;
use crate::provider::registry::create_provider;
use crate::provider::StorageProvider;

pub struct ConnectionManager {
    active: Arc<RwLock<HashMap<String, Box<dyn StorageProvider>>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Open a new connection. Returns the connection ID.
    pub async fn connect(
        &self,
        config: &ConnectionConfig,
        secret: Option<String>,
    ) -> Result<String, AppError> {
        let id = config.id().to_string();

        // If no secret provided, try the OS keyring
        let actual_secret = match secret {
            Some(s) => Some(s),
            None => CredentialStore::get(&id, "password")?,
        };

        let provider = create_provider(config, actual_secret).await?;

        let mut active = self.active.write().await;
        active.insert(id.clone(), provider);
        Ok(id)
    }

    /// List directory via an active connection.
    pub async fn list_dir(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<Vec<crate::provider::FileEntry>, AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.list_dir(path).await
    }

    /// Get file info via an active connection.
    pub async fn get_info(
        &self,
        connection_id: &str,
        path: &str,
    ) -> Result<crate::provider::FileInfo, AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.get_info(path).await
    }

    /// Download a file via an active connection.
    pub async fn download(
        &self,
        connection_id: &str,
        remote_path: &str,
        local_path: &std::path::PathBuf,
        on_progress: Option<crate::provider::ProgressCallback>,
    ) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider
            .download(remote_path, local_path, on_progress)
            .await
    }

    /// Upload a file via an active connection.
    pub async fn upload(
        &self,
        connection_id: &str,
        local_path: &std::path::PathBuf,
        remote_path: &str,
        on_progress: Option<crate::provider::ProgressCallback>,
    ) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.upload(local_path, remote_path, on_progress).await
    }

    /// Delete a file via an active connection.
    pub async fn delete_file(&self, connection_id: &str, path: &str) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.delete_file(path).await
    }

    /// Delete a directory via an active connection.
    pub async fn delete_dir(
        &self,
        connection_id: &str,
        path: &str,
        recursive: bool,
    ) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.delete_dir(path, recursive).await
    }

    /// Rename a file/directory via an active connection.
    pub async fn rename(&self, connection_id: &str, from: &str, to: &str) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.rename(from, to).await
    }

    /// Create a directory via an active connection.
    pub async fn mkdir(&self, connection_id: &str, path: &str) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.mkdir(path).await
    }

    /// Get provider capabilities for an active connection.
    pub async fn capabilities(
        &self,
        connection_id: &str,
    ) -> Result<crate::provider::ProviderCapabilities, AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        Ok(provider.capabilities())
    }

    /// List available owners/groups for an active connection.
    pub async fn list_ownership_options(
        &self,
        connection_id: &str,
    ) -> Result<crate::provider::OwnershipOptions, AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.list_ownership_options().await
    }

    /// Update file/folder properties for an active connection.
    pub async fn set_file_properties(
        &self,
        connection_id: &str,
        path: &str,
        update: crate::provider::FilePropertyUpdate,
    ) -> Result<(), AppError> {
        let active = self.active.read().await;
        let provider = active.get(connection_id).ok_or_else(|| {
            AppError::NotFound(format!("No active connection: {}", connection_id))
        })?;
        provider.set_file_properties(path, update).await
    }

    /// Disconnect and remove an active connection.
    pub async fn disconnect(&self, connection_id: &str) -> Result<(), AppError> {
        let mut active = self.active.write().await;
        if let Some(provider) = active.remove(connection_id) {
            provider.disconnect().await?;
        }
        Ok(())
    }

    /// Check if a connection is active.
    pub async fn is_connected(&self, connection_id: &str) -> bool {
        let active = self.active.read().await;
        active.contains_key(connection_id)
    }

    /// Disconnect all active connections.
    pub async fn disconnect_all(&self) -> Result<(), AppError> {
        let mut active = self.active.write().await;
        for (_, provider) in active.drain() {
            let _ = provider.disconnect().await;
        }
        Ok(())
    }
}
