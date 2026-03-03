use crate::error::AppError;
use keyring::Entry;

const SERVICE_NAME: &str = "EverythingBrowser";

pub struct CredentialStore;

impl CredentialStore {
    /// Store a secret in the OS keyring.
    pub fn save(connection_id: &str, credential_type: &str, secret: &str) -> Result<(), AppError> {
        let key = format!("{}:{}", connection_id, credential_type);
        let entry =
            Entry::new(SERVICE_NAME, &key).map_err(|e| AppError::CredentialError(e.to_string()))?;
        entry
            .set_password(secret)
            .map_err(|e| AppError::CredentialError(e.to_string()))?;
        Ok(())
    }

    /// Retrieve a secret from the OS keyring.
    pub fn get(connection_id: &str, credential_type: &str) -> Result<Option<String>, AppError> {
        let key = format!("{}:{}", connection_id, credential_type);
        let entry =
            Entry::new(SERVICE_NAME, &key).map_err(|e| AppError::CredentialError(e.to_string()))?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(AppError::CredentialError(e.to_string())),
        }
    }

    /// Delete a secret from the OS keyring.
    pub fn delete(connection_id: &str, credential_type: &str) -> Result<(), AppError> {
        let key = format!("{}:{}", connection_id, credential_type);
        let entry =
            Entry::new(SERVICE_NAME, &key).map_err(|e| AppError::CredentialError(e.to_string()))?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(AppError::CredentialError(e.to_string())),
        }
    }
}
