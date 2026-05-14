use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tracing::info;

// PtyManager is always held as Arc<PtyManager> so child threads can clean up sessions on exit.

#[derive(Clone, Debug)]
pub enum PtyEvent {
    Data { id: String, data: String },
    Exit { id: String, exit_code: i32 },
}

pub struct PtyManager {
    pub event_tx: tokio::sync::broadcast::Sender<PtyEvent>,
    sessions: Mutex<HashMap<String, PtySessionHandle>>,
    counter: Mutex<u32>,
}

struct PtySessionHandle {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    master: Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        let (event_tx, _) = tokio::sync::broadcast::channel(4096);
        Self {
            event_tx,
            sessions: Mutex::new(HashMap::new()),
            counter: Mutex::new(0),
        }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<PtyEvent> {
        self.event_tx.subscribe()
    }

    pub fn spawn(
        self: &Arc<Self>,
        shell: Option<&str>,
        cwd: Option<&str>,
        cols: u16,
        rows: u16,
    ) -> anyhow::Result<String> {
        let mut n = self.counter.lock().unwrap();
        *n += 1;
        let id = format!("pty-{}", *n);
        drop(n);

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell_path = shell
            .map(|s| s.to_string())
            .or_else(|| std::env::var("SHELL").ok())
            .unwrap_or_else(|| {
                if cfg!(windows) {
                    "powershell.exe".into()
                } else {
                    "/bin/zsh".into()
                }
            });

        let cwd_path = cwd
            .map(PathBuf::from)
            .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("/"));

        let mut cmd = CommandBuilder::new(&shell_path);
        if !cfg!(target_os = "windows") {
            cmd.arg("-i");
        }
        cmd.cwd(&cwd_path);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for key in ["HOME", "USER", "PATH", "SHELL", "TMPDIR"] {
            if let Ok(v) = std::env::var(key) {
                cmd.env(key, &v);
            }
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let master = Arc::new(Mutex::new(pair.master));
        let child = Arc::new(Mutex::new(child));
        let writer = Arc::new(Mutex::new(writer));

        let tx = self.event_tx.clone();
        let id_read = id.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let txt = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = tx.send(PtyEvent::Data {
                            id: id_read.clone(),
                            data: txt,
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        let pm = Arc::clone(self);
        let id_exit = id.clone();
        let child_wait = Arc::clone(&child);
        thread::spawn(move || {
            let status = {
                let mut g = child_wait.lock().unwrap();
                g.wait()
            };
            let code = match status {
                Ok(st) => st.exit_code() as i32,
                Err(_) => -1,
            };
            pm.remove_session(&id_exit);
            let _ = pm.event_tx.send(PtyEvent::Exit {
                id: id_exit,
                exit_code: code,
            });
        });

        self.sessions.lock().unwrap().insert(
            id.clone(),
            PtySessionHandle {
                writer,
                child,
                master,
            },
        );
        info!("PTY spawned {}", id);
        Ok(id)
    }

    pub fn write(&self, session_id: &str, data: &str) -> bool {
        let s = self.sessions.lock().unwrap();
        let Some(sess) = s.get(session_id) else {
            return false;
        };
        let mut w = sess.writer.lock().unwrap();
        w.write_all(data.as_bytes()).is_ok()
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> bool {
        let s = self.sessions.lock().unwrap();
        let Some(sess) = s.get(session_id) else {
            return false;
        };
        let m = sess.master.lock().unwrap();
        m.resize(PtySize {
            cols,
            rows,
            pixel_width: 0,
            pixel_height: 0,
        })
        .is_ok()
    }

    pub fn kill(&self, session_id: &str) -> bool {
        let mut s = self.sessions.lock().unwrap();
        let Some(sess) = s.remove(session_id) else {
            return false;
        };
        let mut c = sess.child.lock().unwrap();
        let _ = c.kill();
        info!("PTY killed {}", session_id);
        true
    }

    pub fn remove_session(&self, session_id: &str) {
        self.sessions.lock().unwrap().remove(session_id);
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}
