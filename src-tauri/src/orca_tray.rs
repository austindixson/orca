//! macOS menu bar (system tray) icon — toggles the compact orchestrator / gateway panel.

use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::App;
use tauri::Manager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub fn setup_tray(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri_plugin_positioner::{Position, WindowExt};

    let icon = app
        .default_window_icon()
        .ok_or("missing default window icon for tray")?;

    let _tray = TrayIconBuilder::new()
        .icon(icon.clone())
        .icon_as_template(true)
        .tooltip("Orca — companion & gateway")
        .on_tray_icon_event(|tray, event| {
            tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(win) = app.get_webview_window("tray-panel") {
                    let visible = win.is_visible().unwrap_or(false);
                    if visible {
                        let _ = win.hide();
                    } else {
                        let _ = win.move_window(Position::TrayBottomCenter);
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub fn setup_tray(_app: &App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
