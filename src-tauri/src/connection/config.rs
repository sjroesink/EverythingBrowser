use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ConnectionConfig {
    Sftp(SftpConfig),
    BackblazeB2(B2Config),
}

impl ConnectionConfig {
    pub fn id(&self) -> &str {
        match self {
            ConnectionConfig::Sftp(c) => &c.id,
            ConnectionConfig::BackblazeB2(c) => &c.id,
        }
    }

    pub fn name(&self) -> &str {
        match self {
            ConnectionConfig::Sftp(c) => &c.name,
            ConnectionConfig::BackblazeB2(c) => &c.name,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpConfig {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SftpAuthMethod,
    #[serde(default)]
    pub use_ssh_agent: bool,
    pub default_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "method")]
pub enum SftpAuthMethod {
    Password,
    PrivateKey {
        #[serde(rename = "keyPath")]
        key_path: String,
        #[serde(rename = "passphraseProtected")]
        passphrase_protected: bool,
    },
    KeyboardInteractive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct B2Config {
    pub id: String,
    pub name: String,
    pub application_key_id: String,
    pub bucket_name: String,
    pub region: String,
    pub endpoint: Option<String>,
    pub prefix: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnection {
    pub config: ConnectionConfig,
    pub created_at: i64,
    pub last_connected: Option<i64>,
    pub color: Option<String>,
    pub sort_order: i32,
}
