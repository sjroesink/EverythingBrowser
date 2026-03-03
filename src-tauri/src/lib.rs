mod commands;
mod connection;
mod credentials;
mod error;
mod importer;
mod provider;

use connection::ConnectionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![
            commands::connection_commands::connect,
            commands::connection_commands::disconnect,
            commands::connection_commands::test_connection,
            commands::connection_commands::is_connected,
            commands::file_commands::list_dir,
            commands::file_commands::get_file_info,
            commands::file_commands::download_file,
            commands::file_commands::upload_file,
            commands::file_commands::delete_file,
            commands::file_commands::delete_dir,
            commands::file_commands::rename_item,
            commands::file_commands::create_dir,
            commands::credential_commands::save_credential,
            commands::credential_commands::delete_credential,
            importer::detect_import_sources,
            importer::get_importable_sessions,
            importer::import_sessions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
