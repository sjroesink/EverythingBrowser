use crate::connection::config::ConnectionConfig;
use crate::error::AppError;

use super::b2::BackblazeB2Provider;
use super::sftp::SftpProvider;
use super::StorageProvider;

/// Create a StorageProvider from a ConnectionConfig + optional secret.
pub async fn create_provider(
    config: &ConnectionConfig,
    secret: Option<String>,
) -> Result<Box<dyn StorageProvider>, AppError> {
    match config {
        ConnectionConfig::Sftp(sftp_config) => {
            let provider = SftpProvider::connect(sftp_config.clone(), secret).await?;
            Ok(Box::new(provider))
        }
        ConnectionConfig::BackblazeB2(b2_config) => {
            let key = secret.ok_or(AppError::AuthenticationFailed(
                "Application key required for Backblaze B2".into(),
            ))?;
            let provider = BackblazeB2Provider::connect(b2_config.clone(), key).await?;
            Ok(Box::new(provider))
        }
    }
}
