use async_trait::async_trait;
use std::path::{Path, PathBuf};
use tokio::fs;

use crate::connection::config::LocalFsConfig;
use crate::error::AppError;

use super::{FileEntry, FileInfo, ProgressCallback, ProviderCapabilities, StorageProvider};

pub struct LocalFsProvider {
    root: PathBuf,
    #[allow(dead_code)]
    config: LocalFsConfig,
}

impl LocalFsProvider {
    pub async fn connect(config: LocalFsConfig) -> Result<Self, AppError> {
        let root = PathBuf::from(&config.path);
        if !root.exists() {
            return Err(AppError::ConnectionFailed(format!(
                "Directory does not exist: {}",
                config.path
            )));
        }
        if !root.is_dir() {
            return Err(AppError::ConnectionFailed(format!(
                "Path is not a directory: {}",
                config.path
            )));
        }
        Ok(Self { root, config })
    }

    /// Resolve a virtual path (starting with /) to an absolute path within the root.
    fn resolve(&self, path: &str) -> PathBuf {
        if path == "/" || path.is_empty() {
            return self.root.clone();
        }
        let relative = path.trim_start_matches('/');
        self.root.join(relative)
    }

    /// Convert an absolute path back to a virtual path relative to root.
    fn to_virtual(&self, abs: &Path) -> String {
        match abs.strip_prefix(&self.root) {
            Ok(rel) => {
                let s = rel.to_string_lossy().replace('\\', "/");
                if s.is_empty() {
                    "/".to_string()
                } else {
                    format!("/{}", s)
                }
            }
            Err(_) => "/".to_string(),
        }
    }
}

#[async_trait]
impl StorageProvider for LocalFsProvider {
    fn provider_type(&self) -> &'static str {
        "LocalFs"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            file_properties: true,
            set_permissions: false,
            set_owner_group: false,
            list_ownership_options: false,
        }
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileEntry>, AppError> {
        let abs = self.resolve(path);
        let mut entries = Vec::new();
        let mut read_dir = fs::read_dir(&abs).await?;

        while let Some(entry) = read_dir.next_entry().await? {
            let metadata = entry.metadata().await?;
            let name = entry.file_name().to_string_lossy().to_string();
            let entry_path = self.to_virtual(&entry.path());

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);

            entries.push(FileEntry {
                name,
                path: entry_path,
                is_dir: metadata.is_dir(),
                size: metadata.len(),
                modified,
                permissions: None,
            });
        }

        entries.sort_by(|a, b| {
            b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    }

    async fn get_info(&self, path: &str) -> Result<FileInfo, AppError> {
        let abs = self.resolve(path);
        let metadata = fs::metadata(&abs).await?;
        let name = abs
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        let created = metadata
            .created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);

        Ok(FileInfo {
            name,
            path: self.to_virtual(&abs),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
            modified,
            created,
            permissions: None,
            owner: None,
            group: None,
            mime_type: None,
        })
    }

    async fn download(
        &self,
        remote_path: &str,
        local_path: &PathBuf,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let src = self.resolve(remote_path);
        let total = fs::metadata(&src).await?.len();

        fs::copy(&src, local_path).await?;

        if let Some(cb) = on_progress {
            cb(total, total);
        }
        Ok(())
    }

    async fn upload(
        &self,
        local_path: &PathBuf,
        remote_path: &str,
        on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let dest = self.resolve(remote_path);
        let total = fs::metadata(local_path).await?.len();

        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).await?;
        }

        fs::copy(local_path, &dest).await?;

        if let Some(cb) = on_progress {
            cb(total, total);
        }
        Ok(())
    }

    async fn delete_file(&self, path: &str) -> Result<(), AppError> {
        let abs = self.resolve(path);
        fs::remove_file(&abs).await?;
        Ok(())
    }

    async fn delete_dir(&self, path: &str, recursive: bool) -> Result<(), AppError> {
        let abs = self.resolve(path);
        if recursive {
            fs::remove_dir_all(&abs).await?;
        } else {
            fs::remove_dir(&abs).await?;
        }
        Ok(())
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        let from_abs = self.resolve(from);
        let to_abs = self.resolve(to);
        fs::rename(&from_abs, &to_abs).await?;
        Ok(())
    }

    async fn mkdir(&self, path: &str) -> Result<(), AppError> {
        let abs = self.resolve(path);
        fs::create_dir_all(&abs).await?;
        Ok(())
    }

    async fn ping(&self) -> Result<bool, AppError> {
        Ok(self.root.exists() && self.root.is_dir())
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        Ok(())
    }
}
