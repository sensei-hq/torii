mod gateway;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  // Build the in-process inference engine (local plane, Phase 1b) before the
  // Tauri builder. `build_gateway` is async and `run()` is sync, so block on it
  // here, then hand the `Arc<Gateway>` to Tauri's managed state for commands to
  // resolve via `State<Arc<Gateway>>`.
  let gateway = tauri::async_runtime::block_on(gateway::build_gateway());

  let builder = tauri::Builder::default()
    .manage(gateway)
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
