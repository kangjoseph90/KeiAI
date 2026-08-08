mod recording;
mod tokenizer;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            let stronghold_dir = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&stronghold_dir)?;
            let salt_path = stronghold_dir.join("stronghold-salt.bin");
            app.handle()
                .plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .manage(std::sync::Mutex::new(recording::RecordingState::new()))
        .manage(std::sync::Mutex::new(tokenizer::TokenizerState::new()))
        .invoke_handler(tauri::generate_handler![
            tokenizer::count_tokens,
            recording::start_audio_recording,
            recording::finish_audio_recording,
            recording::cancel_audio_recording
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
