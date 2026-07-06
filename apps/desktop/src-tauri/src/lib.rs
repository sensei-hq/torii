#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    });

  #[cfg(feature = "e2e-testing")]
  let builder = builder.plugin(tauri_plugin_playwright::init());

  builder
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
