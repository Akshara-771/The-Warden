// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, State, AppHandle};
use std::{
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use rand::Rng;

#[derive(Default)]
struct CameraState {
    cleanup_done: bool,
}

// A new command for the frontend to call to exit the application.
#[tauri::command]
fn exit_app(app_handle: AppHandle) {
    println!("Frontend requested app exit.");
    app_handle.exit(0);
}

#[tauri::command]
fn js_to_rust_hide_window(app_handle: AppHandle) {
    println!("Received command from JS to hide the window.");
    if let Some(window) = app_handle.get_webview_window("main") {
        if let Err(e) = window.hide() {
            println!("Error hiding window: {}", e);
        }
    }
}

#[tauri::command]
fn camera_cleanup_complete(state: State<'_, Arc<Mutex<CameraState>>>) {
    let mut guard = state.lock().unwrap();
    guard.cleanup_done = true;
    println!("✅ Rust: Received camera cleanup confirmation from frontend.");
}

fn warden_loop(app: AppHandle, camera_state: Arc<Mutex<CameraState>>) {
    thread::spawn(move || {
        let mut is_first_run = true;

        loop {
            if !is_first_run {
                let timeout_duration = Duration::from_secs(8);
                let start_wait = Instant::now();
                println!("Rust: Waiting for camera cleanup...");

                loop {
                    {
                        let mut state = camera_state.lock().unwrap();
                        if state.cleanup_done {
                            println!("Rust: JS completed camera cleanup.");
                            state.cleanup_done = false;
                            break;
                        }
                    }

                    if start_wait.elapsed() >= timeout_duration {
                        println!(
                            "⚠️ Rust: Timeout reached after {} seconds. Proceeding anyway.",
                            timeout_duration.as_secs()
                        );
                        break;
                    }

                    thread::sleep(Duration::from_millis(100));
                }
            }

            is_first_run = false;

            let wait_seconds = rand::thread_rng().gen_range(10..20);
            println!("😴 Warden is sleeping for {} seconds.", wait_seconds);
            thread::sleep(Duration::from_secs(wait_seconds));

            println!("🧟‍♂️ Warden is waking up! Ambush time.");
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_always_on_top(true); // Ensure it's always on top
                let _ = window.center();
                let _ = window.set_focus();
            }
        }
    });
}

fn main() {
    let camera_state = Arc::new(Mutex::new(CameraState::default()));

    tauri::Builder::default()
        // Here is where we configure the window properties
        .setup(move |app| {
            let app_handle = app.handle();
            let window = app_handle.get_webview_window("main").unwrap();
            
            // Set window properties at runtime after it's been created
            let _ = window.set_resizable(false);
            let _ = window.set_maximizable(false);
            let _ = window.set_minimizable(false);
            let _ = window.set_closable(false);
            let _ = window.set_always_on_top(true);
            let _ = window.set_decorations(false);
            
            warden_loop(app_handle.clone(), camera_state.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            exit_app,
            js_to_rust_hide_window,
            camera_cleanup_complete
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}