use crate::credentials::CredentialStore;
use crate::error::AppError;

#[tauri::command]
pub async fn save_credential(
    connection_id: String,
    credential_type: String,
    secret: String,
) -> Result<(), AppError> {
    CredentialStore::save(&connection_id, &credential_type, &secret)
}

#[tauri::command]
pub async fn delete_credential(
    connection_id: String,
    credential_type: String,
) -> Result<(), AppError> {
    CredentialStore::delete(&connection_id, &credential_type)
}
