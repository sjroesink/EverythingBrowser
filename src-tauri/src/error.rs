use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("Connection failed: {0}")]
    ConnectionFailed(String),

    #[error("Authentication failed: {0}")]
    AuthenticationFailed(String),

    #[error("File operation failed: {0}")]
    FileOperationFailed(String),

    #[error("Transfer failed: {0}")]
    TransferFailed(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Credential storage error: {0}")]
    CredentialError(String),

    #[error("Configuration error: {0}")]
    ConfigError(String),

    #[error("Provider not supported: {0}")]
    UnsupportedProvider(String),

    #[error("{0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::FileOperationFailed(e.to_string())
    }
}
