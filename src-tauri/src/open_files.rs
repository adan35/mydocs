//! Only paths supplied by the operating system enter this queue. The webview cannot
//! request arbitrary disk paths; opening a file imports a copy into its workspace.
use serde::Serialize;
use std::{collections::VecDeque, io::Read, path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

const MAX_BYTES: u64 = 100 * 1024 * 1024;

#[derive(Default)]
pub struct OpenFiles(Mutex<VecDeque<PathBuf>>);

#[derive(Serialize)]
pub struct OpenedFile {
    name: String,
    bytes: Vec<u8>,
    error: Option<String>,
}

pub fn enqueue(app: &tauri::AppHandle, args: Vec<String>, cwd: &str) {
    let state = app.state::<OpenFiles>();
    let mut queue = state.0.lock().unwrap_or_else(|e| e.into_inner());
    for arg in args.into_iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(arg);
        let path = if path.is_absolute() {
            path
        } else {
            PathBuf::from(cwd).join(path)
        };
        if !queue.contains(&path) {
            queue.push_back(path);
        }
    }
    drop(queue);
    let _ = app.emit("mydoc:open-files", ());
}

#[tauri::command]
pub async fn take_open_file(app: tauri::AppHandle) -> Result<Option<OpenedFile>, String> {
    let path = app
        .state::<OpenFiles>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .pop_front();
    let Some(path) = path else {
        return Ok(None);
    };
    tauri::async_runtime::spawn_blocking(move || {
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let read = || -> Result<Vec<u8>, String> {
            let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            let metadata = file.metadata().map_err(|e| e.to_string())?;
            if !metadata.is_file() {
                return Err("Select a file, not a folder.".into());
            }
            if metadata.len() > MAX_BYTES {
                return Err("Files must be 100 MB or smaller.".into());
            }
            let mut bytes = Vec::new();
            file.take(MAX_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err("Files must be 100 MB or smaller.".into());
            }
            Ok(bytes)
        };
        match read() {
            Ok(bytes) => OpenedFile {
                name,
                bytes,
                error: None,
            },
            Err(error) => OpenedFile {
                name,
                bytes: vec![],
                error: Some(error),
            },
        }
    })
    .await
    .map(Some)
    .map_err(|e| e.to_string())
}
