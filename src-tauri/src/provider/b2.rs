use async_trait::async_trait;
use s3::creds::Credentials;
use s3::error::S3Error;
use s3::region::Region;
use s3::Bucket;
use std::path::PathBuf;

use crate::connection::config::B2Config;
use crate::error::AppError;

use super::{FileEntry, FileInfo, ProgressCallback, ProviderCapabilities, StorageProvider};

pub struct BackblazeB2Provider {
    bucket: Box<Bucket>,
    #[allow(dead_code)]
    config: B2Config,
}

impl From<S3Error> for AppError {
    fn from(e: S3Error) -> Self {
        AppError::FileOperationFailed(e.to_string())
    }
}

impl BackblazeB2Provider {
    pub async fn connect(config: B2Config, application_key: String) -> Result<Self, AppError> {
        let endpoint = config
            .endpoint
            .clone()
            .unwrap_or_else(|| format!("https://s3.{}.backblazeb2.com", config.region));

        let region = Region::Custom {
            region: config.region.clone(),
            endpoint,
        };

        let credentials = Credentials::new(
            Some(&config.application_key_id),
            Some(&application_key),
            None,
            None,
            None,
        )
        .map_err(|e| AppError::AuthenticationFailed(e.to_string()))?;

        let bucket = Bucket::new(&config.bucket_name, region, credentials)
            .map_err(|e| AppError::ConnectionFailed(e.to_string()))?
            .with_path_style();

        Ok(Self {
            bucket: Box::new(*bucket),
            config,
        })
    }
}

#[async_trait]
impl StorageProvider for BackblazeB2Provider {
    fn provider_type(&self) -> &'static str {
        "Backblaze B2"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            file_properties: false,
            set_permissions: false,
            set_owner_group: false,
            list_ownership_options: false,
        }
    }

    async fn list_dir(&self, path: &str) -> Result<Vec<FileEntry>, AppError> {
        let prefix = if path == "/" || path.is_empty() {
            self.config.prefix.clone().unwrap_or_default()
        } else {
            let mut p = path.trim_start_matches('/').to_string();
            if !p.ends_with('/') {
                p.push('/');
            }
            p
        };

        let delimiter = Some("/".to_string());
        let results = self
            .bucket
            .list(prefix.clone(), delimiter)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        let mut entries = Vec::new();

        for result in &results {
            // Common prefixes are "subdirectories"
            if let Some(prefixes) = &result.common_prefixes {
                for cp in prefixes {
                    let name = cp
                        .prefix
                        .trim_end_matches('/')
                        .rsplit('/')
                        .next()
                        .unwrap_or(&cp.prefix)
                        .to_string();
                    entries.push(FileEntry {
                        name,
                        path: format!("/{}", cp.prefix),
                        is_dir: true,
                        size: 0,
                        modified: None,
                        permissions: None,
                    });
                }
            }
            // Objects are "files"
            for obj in &result.contents {
                let name = obj.key.rsplit('/').next().unwrap_or(&obj.key).to_string();
                if name.is_empty() {
                    continue;
                }
                entries.push(FileEntry {
                    name,
                    path: format!("/{}", obj.key),
                    is_dir: false,
                    size: obj.size,
                    modified: chrono::DateTime::parse_from_rfc3339(&obj.last_modified)
                        .map(|dt| dt.timestamp())
                        .ok(),
                    permissions: None,
                });
            }
        }

        entries.sort_by(|a, b| {
            b.is_dir
                .cmp(&a.is_dir)
                .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    }

    async fn get_info(&self, path: &str) -> Result<FileInfo, AppError> {
        let key = path.trim_start_matches('/');
        let (head, _status) = self
            .bucket
            .head_object(key)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        let name = key.rsplit('/').next().unwrap_or(key).to_string();

        Ok(FileInfo {
            name,
            path: path.to_string(),
            is_dir: false,
            size: head.content_length.unwrap_or(0) as u64,
            modified: head
                .last_modified
                .and_then(|lm| chrono::DateTime::parse_from_rfc2822(&lm).ok())
                .map(|dt| dt.timestamp()),
            created: None,
            permissions: None,
            owner: None,
            group: None,
            mime_type: head.content_type,
        })
    }

    async fn download(
        &self,
        remote_path: &str,
        local_path: &PathBuf,
        _on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let key = remote_path.trim_start_matches('/');

        let response = self
            .bucket
            .get_object(key)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        std::fs::write(local_path, response.bytes())
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        Ok(())
    }

    async fn upload(
        &self,
        local_path: &PathBuf,
        remote_path: &str,
        _on_progress: Option<ProgressCallback>,
    ) -> Result<(), AppError> {
        let key = remote_path.trim_start_matches('/');
        let content =
            std::fs::read(local_path).map_err(|e| AppError::TransferFailed(e.to_string()))?;

        self.bucket
            .put_object(key, &content)
            .await
            .map_err(|e| AppError::TransferFailed(e.to_string()))?;

        Ok(())
    }

    async fn delete_file(&self, path: &str) -> Result<(), AppError> {
        let key = path.trim_start_matches('/');
        self.bucket
            .delete_object(key)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;
        Ok(())
    }

    async fn delete_dir(&self, path: &str, recursive: bool) -> Result<(), AppError> {
        if !recursive {
            return Ok(());
        }
        // In object storage, "directories" are virtual. Delete all objects with this prefix.
        let entries = self.list_dir(path).await?;
        for entry in entries {
            if entry.is_dir {
                Box::pin(self.delete_dir(&entry.path, true)).await?;
            } else {
                self.delete_file(&entry.path).await?;
            }
        }
        Ok(())
    }

    async fn rename(&self, from: &str, to: &str) -> Result<(), AppError> {
        // B2/S3 has no native rename. Copy + delete.
        let from_key = from.trim_start_matches('/');
        let to_key = to.trim_start_matches('/');

        self.bucket
            .copy_object_internal(from_key, to_key)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        self.bucket
            .delete_object(from_key)
            .await
            .map_err(|e| AppError::FileOperationFailed(e.to_string()))?;

        Ok(())
    }

    async fn mkdir(&self, _path: &str) -> Result<(), AppError> {
        // In object storage, directories are virtual. No-op.
        Ok(())
    }

    async fn ping(&self) -> Result<bool, AppError> {
        // Try listing with a very small limit
        match self
            .bucket
            .list("/".to_string(), Some("/".to_string()))
            .await
        {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    async fn disconnect(&self) -> Result<(), AppError> {
        // No persistent connection to close for S3/B2
        Ok(())
    }
}
