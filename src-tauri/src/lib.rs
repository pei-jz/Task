use std::fs;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
async fn save_file(path: String, content: Vec<u8>) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_modified_time(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let modified = metadata.modified().map_err(|e| e.to_string())?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    Ok(duration.as_millis() as u64)
}

#[tauri::command]
async fn pick_save_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let result = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_save_file();

    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
async fn pick_open_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let result = app
        .dialog()
        .file()
        .add_filter("JSON", &["json"])
        .blocking_pick_file();

    match result {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
fn get_initial_file(state: tauri::State<'_, InitialFile>) -> Option<String> {
    state.0.lock().unwrap().clone()
}

struct InitialFile(std::sync::Mutex<Option<String>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_file = std::env::args()
        .nth(1)
        .filter(|arg| arg.ends_with(".wbs"));

    tauri::Builder::default()
        .manage(InitialFile(std::sync::Mutex::new(initial_file.clone())))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .setup(move |app| {
            if let Some(path) = initial_file {
                use tauri::Emitter;
                let _ = app.emit("startup-file", path);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            save_file,
            read_file,
            get_modified_time,
            pick_save_path,
            pick_open_path,
            get_initial_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
