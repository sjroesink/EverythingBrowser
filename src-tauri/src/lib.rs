mod commands;
mod connection;
mod credentials;
mod error;
mod importer;
mod provider;

use connection::config::{ConnectionConfig, SavedConnection};
use connection::ConnectionManager;
use credentials::CredentialStore;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_cli::CliExt;

/// Data passed from CLI --connect arg to the frontend detached window.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliLaunchData {
    pub config: ConnectionConfig,
    pub secret: Option<String>,
}

/// Wrapper so we can put it in Tauri managed state.
struct CliLaunchState(Mutex<Option<CliLaunchData>>);

#[tauri::command]
fn get_cli_connection(state: tauri::State<'_, CliLaunchState>) -> Option<CliLaunchData> {
    state.0.lock().unwrap().take()
}

/// Load connections.json from the tauri-plugin-store data directory.
fn load_connections_from_store(app: &tauri::App) -> Vec<SavedConnection> {
    use tauri_plugin_store::StoreExt;

    let store = match app.store("connections.json") {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };

    match store.get("connections") {
        Some(val) => serde_json::from_value::<Vec<SavedConnection>>(val.clone()).unwrap_or_default(),
        None => Vec::new(),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_process::init())
        .manage(ConnectionManager::new())
        .manage(CliLaunchState(Mutex::new(None)))
        .setup(|app| {
            // Check for --connect CLI arg
            match app.cli().matches() {
                Ok(matches) => {
                    if let Some(arg) = matches.args.get("connect") {
                        if let Some(connect_value) = arg.value.as_str() {
                            let connect_str: &str = connect_value;
                            if !connect_str.is_empty() {
                                handle_cli_connect(app, connect_str);
                            }
                        }
                    }
                }
                Err(e) => {
                    // --help and --version come through as errors with the output text
                    println!("{}", e);
                    std::process::exit(0);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection_commands::connect,
            commands::connection_commands::disconnect,
            commands::connection_commands::test_connection,
            commands::connection_commands::is_connected,
            commands::file_commands::list_dir,
            commands::file_commands::get_file_info,
            commands::file_commands::get_provider_capabilities,
            commands::file_commands::list_ownership_options,
            commands::file_commands::set_file_properties,
            commands::file_commands::download_file,
            commands::file_commands::upload_file,
            commands::file_commands::copy_between_connections,
            commands::file_commands::copy_to_system_clipboard,
            commands::file_commands::delete_file,
            commands::file_commands::delete_dir,
            commands::file_commands::rename_item,
            commands::file_commands::create_dir,
            commands::file_commands::download_to_temp,
            commands::file_commands::ensure_drag_icon,
            commands::credential_commands::save_credential,
            commands::credential_commands::delete_credential,
            importer::detect_import_sources,
            importer::get_importable_sessions,
            importer::import_sessions,
            get_cli_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn handle_cli_connect(app: &tauri::App, connect_value: &str) {
    let connections = load_connections_from_store(app);

    // Find connection by name (case-insensitive) or by ID
    let found = connections.iter().find(|saved| {
        saved.config.name().eq_ignore_ascii_case(connect_value)
            || saved.config.id() == connect_value
    });

    let saved = match found {
        Some(s) => s,
        None => {
            eprintln!(
                "Connection '{}' not found. Available connections:",
                connect_value
            );
            for saved in &connections {
                eprintln!("  - {} (id: {})", saved.config.name(), saved.config.id());
            }
            std::process::exit(1);
        }
    };

    // Get secret from keyring
    let secret = CredentialStore::get(saved.config.id(), "password")
        .ok()
        .flatten();

    // Store launch data for the frontend to pick up
    let cli_state = app.state::<CliLaunchState>();
    *cli_state.0.lock().unwrap() = Some(CliLaunchData {
        config: saved.config.clone(),
        secret,
    });

    // Hide the main window
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.hide();
    }

    // Create a detached window for the CLI connection
    let label = format!("detached-cli-{}", saved.config.id());
    let title = format!("EverythingBrowser — {}", saved.config.name());

    let _ = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title(&title)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        .decorations(false)
        .build();
}
