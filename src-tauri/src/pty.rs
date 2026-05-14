use portable_pty::{native_pty_system, CommandBuilder, PtySize, Child, MasterPty};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

pub struct PtySession {
    #[allow(dead_code)]
    id: String,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    running: Arc<Mutex<bool>>,
    #[allow(dead_code)]
    child: Arc<Mutex<Box<dyn Child + Send + Sync>>>,
}

impl PtySession {
    pub fn new(id: &str, cwd: PathBuf, app: AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell = if cfg!(target_os = "windows") {
            "powershell.exe".to_string()
        } else {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
        };

        log::info!("Spawning shell: {} in {:?}", shell, cwd);

        let mut cmd = CommandBuilder::new(&shell);
        if !cfg!(target_os = "windows") {
            cmd.arg("-i");
        }
        cmd.cwd(&cwd);

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("LANG", "en_US.UTF-8");
        cmd.env("LC_ALL", "en_US.UTF-8");

        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", &home);
        }
        if let Ok(user) = std::env::var("USER") {
            cmd.env("USER", &user);
        }
        if let Ok(path) = std::env::var("PATH") {
            cmd.env("PATH", &path);
        }
        if let Ok(shell_env) = std::env::var("SHELL") {
            cmd.env("SHELL", &shell_env);
        }
        if shell.contains("zsh") {
            cmd.env("PROMPT_EOL_MARK", "");
        }
        // TMPDIR is important on macOS
        if let Ok(tmpdir) = std::env::var("TMPDIR") {
            cmd.env("TMPDIR", &tmpdir);
        }

        let mut child = pair.slave.spawn_command(cmd)?;
        match child.try_wait() {
            Ok(None) => log::info!("PTY child started"),
            Ok(Some(status)) => log::warn!("PTY child exited immediately: {:?}", status),
            Err(e) => log::warn!("Unable to probe PTY child state: {}", e),
        }

        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let master = Arc::new(Mutex::new(pair.master));
        let child = Arc::new(Mutex::new(child));
        let writer = Arc::new(Mutex::new(writer));
        let running = Arc::new(Mutex::new(true));

        // Exit events must reflect the shell process lifecycle only. The PTY reader can hit EOF
        // (e.g. alternate-screen TUIs, driver quirks) while the child is still running; the old
        // behavior emitted pty-exit when the reader loop ended, which falsely marked the terminal as errored.
        let id_wait = id.to_string();
        let app_wait = app.clone();
        let child_wait = Arc::clone(&child);
        thread::spawn(move || {
            let status = {
                let mut guard = child_wait.lock().unwrap();
                guard.wait()
            };
            let exit_code: Option<i32> = match status {
                Ok(st) => {
                    log::info!("PTY child process exited: {:?}", st);
                    Some(st.exit_code() as i32)
                }
                Err(e) => {
                    log::warn!("PTY child wait error: {}", e);
                    None
                }
            };
            let _ = app_wait.emit(&format!("pty-exit-{}", id_wait), exit_code);
        });

        let id_clone = id.to_string();
        let running_clone = Arc::clone(&running);
        let child_clone = Arc::clone(&child);

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending = Vec::new();

            loop {
                if !*running_clone.lock().unwrap() {
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        let mut child_guard = child_clone.lock().unwrap();
                        match child_guard.try_wait() {
                            Ok(Some(status)) => log::info!("PTY child exited: {:?}", status),
                            Ok(None) => log::info!("PTY reader reached EOF while child still running"),
                            Err(e) => log::error!("Error checking PTY child on EOF: {}", e),
                        }
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        let mut emitted = String::new();
                        let mut cursor = 0;
                        let mut has_incomplete_suffix = false;

                        while cursor < pending.len() {
                            match std::str::from_utf8(&pending[cursor..]) {
                                Ok(valid) => {
                                    emitted.push_str(valid);
                                    cursor = pending.len();
                                }
                                Err(err) => {
                                    let valid_up_to = cursor + err.valid_up_to();
                                    if valid_up_to > cursor {
                                        emitted.push_str(
                                            std::str::from_utf8(&pending[cursor..valid_up_to]).unwrap_or(""),
                                        );
                                    }

                                    match err.error_len() {
                                        Some(error_len) => {
                                            emitted.push('\u{FFFD}');
                                            cursor = valid_up_to + error_len;
                                        }
                                        None => {
                                            cursor = valid_up_to;
                                            has_incomplete_suffix = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if has_incomplete_suffix {
                            pending.drain(..cursor);
                        } else {
                            pending.clear();
                        }

                        if !emitted.is_empty() {
                            let _ = app.emit(&format!("pty-output-{}", id_clone), emitted);
                        }
                    }
                    Err(e) => {
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::Interrupted
                        {
                            thread::sleep(std::time::Duration::from_millis(10));
                            continue;
                        }
                        log::error!("PTY reader error: {} (kind: {:?})", e, e.kind());
                        break;
                    }
                }
            }
        });

        Ok(Self {
            id: id.to_string(),
            master,
            writer,
            running,
            child,
        })
    }
    
    pub fn write(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }
    
    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error>> {
        let master = self.master.lock().unwrap();
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }
    
    pub fn close(&self) {
        *self.running.lock().unwrap() = false;
        if let Ok(mut guard) = self.child.lock() {
            // The PTY child is the shell, and portable_pty calls `setsid()` before exec so
            // the shell is the session leader with PGID == PID. Any dev server the user
            // launched inside the shell (npm run dev, cargo run, vite, etc.) typically
            // inherits the shell's process group. Killing just the shell PID orphans those
            // children, so on Unix we target the whole process group with SIGTERM first
            // (to give Vite/Next/Node a chance to clean up ports), then SIGKILL.
            #[cfg(unix)]
            {
                if let Some(pid) = guard.process_id() {
                    let pgid = pid as i32;
                    unsafe {
                        libc::kill(-pgid, libc::SIGTERM);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(120));
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                }
            }
            if let Err(e) = guard.kill() {
                log::warn!("PTY child kill: {}", e);
            }
        }
    }
}
