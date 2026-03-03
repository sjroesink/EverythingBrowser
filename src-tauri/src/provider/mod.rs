pub mod b2;
pub mod registry;
pub mod sftp;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::error::AppError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<i64>,
    pub created: Option<i64>,
    pub permissions: Option<String>,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub mime_type: Option<String>,
}

pub type ProgressCallback = Box<dyn Fn(u64, u64) + Send + Sync>;

#[async_trait]
pub trait StorageProvider: Send + Sync {
    /// Human-readable name for this provider type.
    fn provider_type(&self) -> &'static str;

    /// List contents of a directory (or bucket prefix). "/" for root.
    async fn list_dir(&self, path: &str) -> Result<Vec<FileEntry>, AppError>;

    /// Get detailed metadata for a single file or directory.
    async fn get_info(&self, path: &str) -> Result<FileInfo, AppError>;

    /// Download a remote file to a local path.
    async fn download(
        &self,
        remote_path: &str,
        local_path: &PathBuf,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError>;

    /// Upload a local file to a remote path.
    async fn upload(
        &self,
        local_path: &PathBuf,
        remote_path: &str,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError>;

    /// Delete a single file.
    async fn delete_file(&self, path: &str) -> Result<(), AppError>;

    /// Delete a directory. If recursive, removes non-empty dirs.
    async fn delete_dir(&self, path: &str, recursive: bool) -> Result<(), AppError>;

    /// Rename or move a file/directory.
    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError>;

    /// Create a new directory.
    async fn mkdir(&self, path: &str) -> Result<(), AppError>;

    /// Check if the connection is still alive.
    async fn ping(&self) -> Result<bool, AppError>;

    /// Gracefully close the connection.
    async fn disconnect(&self) -> Result<(), AppError>;
}
