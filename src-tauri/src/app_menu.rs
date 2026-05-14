//! Native menubar (File / Edit / View) for desktop — emits `orca-menu` to the webview on custom items.
#![cfg(not(any(target_os = "android", target_os = "ios")))]

use std::sync::Mutex;
use tauri::menu::{
    CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Runtime, Wry};

const EVT_ORCA_MENU: &str = "orca-menu";

pub const ID_OPEN_RECENT_PREFIX: &str = "orca.recent.";

#[derive(Clone, serde::Serialize)]
pub struct OrcaMenuPayload {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arg: Option<String>,
}

/// Holds dynamic submenu + check items so we can rebuild / sync from the frontend.
pub struct OrcaMenuState {
    pub recent_submenu: Mutex<Option<Submenu<Wry>>>,
    pub recent_paths: Mutex<Vec<String>>,
    auto_save_item: Mutex<Option<CheckMenuItem<Wry>>>,
    word_wrap_item: Mutex<Option<CheckMenuItem<Wry>>>,
}

fn emit_menu_event<R: Runtime>(app: &AppHandle<R>, id: impl Into<String>, arg: Option<String>) {
    let payload = OrcaMenuPayload {
        id: id.into(),
        arg,
    };
    let _ = app.emit(EVT_ORCA_MENU, &payload);
}

pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id_str = event.id().as_ref();

    if id_str == "orca.recent.empty" {
        return;
    }

    if id_str == "file.toggle-auto-save" || id_str == "view.toggle-word-wrap" {
        emit_menu_event(
            app,
            id_str.to_string(),
            None,
        );
        return;
    }

    if let Some(rest) = id_str.strip_prefix(ID_OPEN_RECENT_PREFIX) {
        if rest.chars().all(|c| c.is_ascii_digit()) {
            let idx: usize = rest.parse().unwrap_or(usize::MAX);
            let path = app
                .try_state::<OrcaMenuState>()
                .and_then(|s| {
                    let v = s.recent_paths.lock().ok()?;
                    v.get(idx).cloned()
                });
            emit_menu_event(
                app,
                "file.open-recent",
                path,
            );
        }
        return;
    }

    // Forward custom ids (file.*, edit.*, view.*) — not predefined OS items.
    if id_str.starts_with("file.")
        || id_str.starts_with("edit.")
        || id_str.starts_with("view.")
    {
        emit_menu_event(app, id_str.to_string(), None);
    }
}

fn build_file_menu(
    app: &AppHandle<Wry>,
    state: &OrcaMenuState,
    auto_save: bool,
) -> tauri::Result<Submenu<Wry>> {
    let recent_empty = Submenu::with_items(
        app,
        "Open Recent",
        true,
        &[&MenuItem::with_id(
            app,
            "orca.recent.empty",
            "(No recent projects)",
            false,
            None::<&str>,
        )?],
    )?;
    *state.recent_submenu.lock().unwrap() = Some(recent_empty.clone());

    let auto_save_item = CheckMenuItem::with_id(
        app,
        "file.toggle-auto-save",
        "Auto Save",
        true,
        auto_save,
        None::<&str>,
    )?;
    *state.auto_save_item.lock().unwrap() = Some(auto_save_item.clone());

    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(
                app,
                "file.new-text-file",
                "New Text File",
                true,
                Some("CmdOrCtrl+N"),
            )?,
            &MenuItem::with_id(
                app,
                "file.new-window",
                "New Window",
                true,
                Some("Shift+CmdOrCtrl+N"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "file.open-file",
                "Open…",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &MenuItem::with_id(app, "file.open-folder", "Open Folder…", true, None::<&str>)?,
            &recent_empty,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "file.save-as",
                "Save As…",
                true,
                Some("Shift+CmdOrCtrl+S"),
            )?,
            &MenuItem::with_id(
                app,
                "file.save-all",
                "Save All",
                true,
                Some("Alt+CmdOrCtrl+S"),
            )?,
            &auto_save_item,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "file.revert", "Revert File", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "file.close-editor",
                "Close Editor",
                true,
                Some("CmdOrCtrl+W"),
            )?,
            &MenuItem::with_id(
                app,
                "file.close-folder",
                "Close Folder",
                true,
                Some("Shift+CmdOrCtrl+F"),
            )?,
            &PredefinedMenuItem::close_window(app, Some("Close Window"))?,
        ],
    )?;
    Ok(file)
}

fn build_edit_menu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    let find = MenuItem::with_id(
        app,
        "edit.find",
        "Find",
        true,
        Some("CmdOrCtrl+F"),
    )?;
    let replace = MenuItem::with_id(
        app,
        "edit.replace",
        "Replace",
        true,
        Some("Alt+CmdOrCtrl+F"),
    )?;
    let find_files = MenuItem::with_id(
        app,
        "edit.find-in-files",
        "Find in Files",
        true,
        Some("Shift+CmdOrCtrl+F"),
    )?;
    let line_comment = MenuItem::with_id(
        app,
        "edit.toggle-line-comment",
        "Toggle Line Comment",
        true,
        Some("CmdOrCtrl+/"),
    )?;
    let block_comment = MenuItem::with_id(
        app,
        "edit.toggle-block-comment",
        "Toggle Block Comment",
        true,
        Some("Shift+Alt+A"),
    )?;

    let mut b = SubmenuBuilder::new(app, "Edit");
    #[cfg(target_os = "macos")]
    {
        b = b.undo().redo().separator();
    }
    b = b
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .item(&replace)
        .item(&find_files)
        .item(&line_comment)
        .item(&block_comment);
    b.build()
}

fn build_appearance_submenu(app: &AppHandle<Wry>) -> tauri::Result<Submenu<Wry>> {
    Submenu::with_items(
        app,
        "Appearance",
        true,
        &[
            &MenuItem::with_id(app, "view.theme.light", "Light", true, None::<&str>)?,
            &MenuItem::with_id(app, "view.theme.dark", "Dark", true, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "view.theme.system",
                "Follow System",
                true,
                None::<&str>,
            )?,
        ],
    )
}

fn build_view_menu(
    app: &AppHandle<Wry>,
    state: &OrcaMenuState,
    word_wrap: bool,
) -> tauri::Result<Submenu<Wry>> {
    let appearance = build_appearance_submenu(app)?;
    let word_wrap_item = CheckMenuItem::with_id(
        app,
        "view.toggle-word-wrap",
        "Word Wrap",
        true,
        word_wrap,
        Some("Alt+Z"),
    )?;
    *state.word_wrap_item.lock().unwrap() = Some(word_wrap_item.clone());

    Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(
                app,
                "view.command-palette",
                "Command Palette…",
                true,
                Some("Shift+CmdOrCtrl+P"),
            )?,
            &MenuItem::with_id(
                app,
                "view.toggle-explorer",
                "Explorer",
                true,
                Some("Shift+CmdOrCtrl+E"),
            )?,
            &MenuItem::with_id(
                app,
                "view.new-terminal-tile",
                "Terminal",
                true,
                Some("Ctrl+`"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &word_wrap_item,
            &appearance,
        ],
    )
}

/// Build and install the application menubar.
pub fn install(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let auto_save = true;
    let word_wrap = true;

    let state = OrcaMenuState {
        recent_submenu: Mutex::new(None),
        recent_paths: Mutex::new(Vec::new()),
        auto_save_item: Mutex::new(None),
        word_wrap_item: Mutex::new(None),
    };

    let file = build_file_menu(app, &state, auto_save)?;
    let edit = build_edit_menu(app)?;
    let view = build_view_menu(app, &state, word_wrap)?;

    app.manage(state);

    let menu = Menu::with_items(app, &[&file, &edit, &view])?;
    app.set_menu(menu)?;
    Ok(())
}

/// Replace entries under **Open Recent** from absolute paths (typically from localStorage).
#[tauri::command]
pub fn rebuild_recent_submenu(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<OrcaMenuState>();
    let submenu = {
        let g = state.recent_submenu.lock().map_err(|e| e.to_string())?;
        g.clone().ok_or_else(|| "recent submenu not initialized".to_string())?
    };

    while submenu
        .items()
        .map_err(|e| e.to_string())?
        .len()
        > 0
    {
        submenu
            .remove_at(0)
            .map_err(|e| e.to_string())?;
    }

    {
        let mut rp = state.recent_paths.lock().map_err(|e| e.to_string())?;
        *rp = paths.clone();
    }

    if paths.is_empty() {
        let placeholder = MenuItem::with_id(
            &app,
            "orca.recent.empty",
            "(No recent projects)",
            false,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        submenu.append(&placeholder).map_err(|e| e.to_string())?;
    } else {
        for (idx, path) in paths.iter().enumerate() {
            let label = std::path::Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.clone());
            let id = format!("{ID_OPEN_RECENT_PREFIX}{idx}");
            let item =
                MenuItem::with_id(&app, id, label, true, None::<&str>).map_err(|e| e.to_string())?;
            submenu.append(&item).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn sync_native_menu_checks(
    app: AppHandle,
    editor_auto_save_enabled: bool,
    editor_word_wrap_on: bool,
) -> Result<(), String> {
    let state = app.state::<OrcaMenuState>();
    if let Some(ref item) = *state.auto_save_item.lock().map_err(|e| e.to_string())? {
        let _ = item.set_checked(editor_auto_save_enabled);
    }
    if let Some(ref item) = *state.word_wrap_item.lock().map_err(|e| e.to_string())? {
        let _ = item.set_checked(editor_word_wrap_on);
    }
    Ok(())
}
