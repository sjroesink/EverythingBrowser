use crate::error::AppError;
use serde::Serialize;

#[derive(Serialize)]
pub struct DetectedEditor {
    pub name: String,
    pub path: String,
}

/// Check if a command is available on PATH.
fn find_in_path(cmd: &str) -> bool {
    #[cfg(windows)]
    {
        std::process::Command::new("where")
            .arg(cmd)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("which")
            .arg(cmd)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

struct EditorCandidate {
    name: &'static str,
    /// Short command names to check on PATH (preferred, tried first).
    cli_names: Vec<&'static str>,
    /// Absolute paths to check as fallback.
    install_paths: Vec<std::path::PathBuf>,
}

#[tauri::command]
pub async fn detect_editors() -> Vec<DetectedEditor> {
    tokio::task::spawn_blocking(|| {
        let mut editors = Vec::new();

        let candidates: Vec<EditorCandidate> = {
            let mut c = Vec::new();

            #[cfg(windows)]
            {
                let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
                let pf = std::env::var("ProgramFiles").unwrap_or_else(|_| r"C:\Program Files".into());
                let pf86 = std::env::var("ProgramFiles(x86)").unwrap_or_else(|_| r"C:\Program Files (x86)".into());
                let user = std::env::var("USERPROFILE").unwrap_or_default();

                c.push(EditorCandidate {
                    name: "VS Code",
                    cli_names: vec!["code", "code.cmd"],
                    install_paths: vec![
                        std::path::PathBuf::from(&local).join(r"Programs\Microsoft VS Code\Code.exe"),
                        std::path::PathBuf::from(&pf).join(r"Microsoft VS Code\Code.exe"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Notepad++",
                    cli_names: vec!["notepad++"],
                    install_paths: vec![
                        std::path::PathBuf::from(&pf).join(r"Notepad++\notepad++.exe"),
                        std::path::PathBuf::from(&pf86).join(r"Notepad++\notepad++.exe"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Zed",
                    cli_names: vec!["zed"],
                    install_paths: vec![
                        std::path::PathBuf::from(&local).join(r"Programs\Zed\zed.exe"),
                        std::path::PathBuf::from(&user).join(r".local\bin\zed.exe"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Sublime Text",
                    cli_names: vec!["subl"],
                    install_paths: vec![
                        std::path::PathBuf::from(&pf).join(r"Sublime Text\sublime_text.exe"),
                        std::path::PathBuf::from(&pf).join(r"Sublime Text 3\sublime_text.exe"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Vim",
                    cli_names: vec!["gvim", "vim"],
                    install_paths: vec![
                        std::path::PathBuf::from(&pf).join(r"Vim\vim91\gvim.exe"),
                        std::path::PathBuf::from(&pf).join(r"Vim\vim90\gvim.exe"),
                    ],
                });
            }

            #[cfg(target_os = "macos")]
            {
                c.push(EditorCandidate {
                    name: "VS Code",
                    cli_names: vec!["code"],
                    install_paths: vec![
                        std::path::PathBuf::from("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Zed",
                    cli_names: vec!["zed"],
                    install_paths: vec![
                        std::path::PathBuf::from("/Applications/Zed.app/Contents/MacOS/cli"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Sublime Text",
                    cli_names: vec!["subl"],
                    install_paths: vec![
                        std::path::PathBuf::from("/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl"),
                    ],
                });
            }

            #[cfg(target_os = "linux")]
            {
                c.push(EditorCandidate {
                    name: "VS Code",
                    cli_names: vec!["code"],
                    install_paths: vec![
                        std::path::PathBuf::from("/usr/bin/code"),
                        std::path::PathBuf::from("/usr/local/bin/code"),
                        std::path::PathBuf::from("/snap/bin/code"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Zed",
                    cli_names: vec!["zed"],
                    install_paths: vec![
                        std::path::PathBuf::from("/usr/bin/zed"),
                        std::path::PathBuf::from("/usr/local/bin/zed"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Sublime Text",
                    cli_names: vec!["subl"],
                    install_paths: vec![
                        std::path::PathBuf::from("/usr/bin/subl"),
                        std::path::PathBuf::from("/opt/sublime_text/sublime_text"),
                    ],
                });
                c.push(EditorCandidate {
                    name: "Vim",
                    cli_names: vec!["gvim", "vim"],
                    install_paths: vec![
                        std::path::PathBuf::from("/usr/bin/gvim"),
                    ],
                });
            }

            c
        };

        for candidate in candidates {
            // Prefer short CLI name if found on PATH
            let mut found = false;
            for cli in &candidate.cli_names {
                if find_in_path(cli) {
                    editors.push(DetectedEditor {
                        name: candidate.name.to_string(),
                        path: cli.to_string(),
                    });
                    found = true;
                    break;
                }
            }
            if found {
                continue;
            }

            // Fall back to absolute install paths
            for path in &candidate.install_paths {
                if path.exists() {
                    if let Some(s) = path.to_str() {
                        editors.push(DetectedEditor {
                            name: candidate.name.to_string(),
                            path: s.to_string(),
                        });
                        break;
                    }
                }
            }
        }

        editors
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
pub async fn open_in_editor(editor_path: String, file_path: String) -> Result<(), AppError> {
    if editor_path.is_empty() {
        return Err(AppError::Internal("No editor configured".to_string()));
    }

    tokio::task::spawn_blocking(move || {
        std::process::Command::new(&editor_path)
            .arg(&file_path)
            .spawn()
            .map_err(|e| {
                AppError::Internal(format!(
                    "Failed to open '{}' with editor '{}': {}",
                    file_path, editor_path, e
                ))
            })?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub async fn open_path_in_explorer(path: String) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        #[cfg(windows)]
        {
            std::process::Command::new("explorer")
                .arg(&path)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to open explorer: {}", e)))?;
        }
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg(&path)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to open finder: {}", e)))?;
        }
        #[cfg(target_os = "linux")]
        {
            std::process::Command::new("xdg-open")
                .arg(&path)
                .spawn()
                .map_err(|e| AppError::Internal(format!("Failed to open file manager: {}", e)))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?
}

#[tauri::command]
pub fn get_app_data_dir(app: tauri::AppHandle) -> Result<String, AppError> {
    use tauri::Manager;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("Failed to get app data dir: {}", e)))?;
    path.to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| AppError::Internal("Invalid app data path".into()))
}
