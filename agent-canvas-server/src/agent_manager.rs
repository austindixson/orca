use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tracing::info;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentType {
    Claude,
    Codex,
    Gemini,
    Custom,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentStatus {
    Idle,
    Working,
    Done,
    Error,
}

#[derive(Clone, Debug)]
pub enum AgentEvent {
    Data { id: String, data: String },
    Status { id: String, status: AgentStatus },
    Exit { id: String, exit_code: i32 },
}

#[derive(Serialize)]
pub struct AgentJson {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub agent_type: AgentType,
    pub status: AgentStatus,
    pub command: String,
}

struct AgentInner {
    name: String,
    agent_type: AgentType,
    status: AgentStatus,
    command: String,
    cwd: PathBuf,
    writer: Option<Arc<Mutex<Box<dyn Write + Send>>>>,
    child: Option<Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>>,
}

pub struct AgentManager {
    pub event_tx: tokio::sync::broadcast::Sender<AgentEvent>,
    agents: Mutex<HashMap<String, AgentInner>>,
    counter: Mutex<u32>,
}

fn default_cmd(t: &AgentType) -> &'static str {
    match t {
        AgentType::Claude => "claude",
        AgentType::Codex => "codex",
        AgentType::Gemini => "gemini",
        AgentType::Custom => "bash",
    }
}

impl AgentManager {
    pub fn new() -> Self {
        let (event_tx, _) = tokio::sync::broadcast::channel(4096);
        Self {
            event_tx,
            agents: Mutex::new(HashMap::new()),
            counter: Mutex::new(0),
        }
    }

    pub fn subscribe(&self) -> tokio::sync::broadcast::Receiver<AgentEvent> {
        self.event_tx.subscribe()
    }

    pub fn create_agent(
        &self,
        agent_type: AgentType,
        name: Option<&str>,
        command: Option<&str>,
        cwd: Option<&str>,
    ) -> AgentJson {
        let mut n = self.counter.lock().unwrap();
        *n += 1;
        let num = *n;
        drop(n);

        let id = format!("agent-{}", num);
        let cmd_s = command
            .map(|s| s.to_string())
            .unwrap_or_else(|| default_cmd(&agent_type).to_string());
        let agent_name = name
            .map(|s| s.to_string())
            .unwrap_or_else(|| format!("Agent {}", num));

        let cwd_path = cwd
            .map(PathBuf::from)
            .or_else(|| std::env::var("HOME").ok().map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("/"));

        let inner = AgentInner {
            name: agent_name.clone(),
            agent_type: agent_type.clone(),
            status: AgentStatus::Idle,
            command: cmd_s.clone(),
            cwd: cwd_path,
            writer: None,
            child: None,
        };

        self.agents.lock().unwrap().insert(id.clone(), inner);

        AgentJson {
            id,
            name: agent_name,
            agent_type,
            status: AgentStatus::Idle,
            command: cmd_s,
        }
    }

    pub fn start_agent(self: &Arc<Self>, id: &str) -> anyhow::Result<()> {
        let mut map = self.agents.lock().unwrap();
        let ag = map.get_mut(id).ok_or_else(|| anyhow::anyhow!("unknown agent"))?;
        if ag.writer.is_some() {
            return Ok(());
        }

        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(&ag.command);
        cmd.cwd(&ag.cwd);
        cmd.env("TERM", "xterm-256color");
        for key in ["HOME", "USER", "PATH", "SHELL"] {
            if let Ok(v) = std::env::var(key) {
                cmd.env(key, &v);
            }
        }

        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;
        let child = Arc::new(Mutex::new(child));
        ag.writer = Some(Arc::new(Mutex::new(writer)));

        let tx = self.event_tx.clone();
        let id_read = id.to_string();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let txt = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = tx.send(AgentEvent::Data {
                            id: id_read.clone(),
                            data: txt,
                        });
                    }
                    Err(_) => break,
                }
            }
        });

        let pm = Arc::clone(self);
        let id_exit = id.to_string();
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
            if let Some(inner) = pm.agents.lock().unwrap().get_mut(&id_exit) {
                inner.writer = None;
                inner.child = None;
                inner.status = if code == 0 {
                    AgentStatus::Done
                } else {
                    AgentStatus::Error
                };
            }
            let _ = pm.event_tx.send(AgentEvent::Exit {
                id: id_exit.clone(),
                exit_code: code,
            });
        });

        ag.child = Some(child);
        ag.status = AgentStatus::Idle;
        let _ = self.event_tx.send(AgentEvent::Status {
            id: id.to_string(),
            status: AgentStatus::Idle,
        });
        info!("Agent started {}", id);
        Ok(())
    }

    pub fn send_input(&self, id: &str, data: &str) -> bool {
        let s = self.agents.lock().unwrap();
        let Some(ag) = s.get(id) else {
            return false;
        };
        let Some(w) = &ag.writer else {
            return false;
        };
        let mut w = w.lock().unwrap();
        let ok = w.write_all(data.as_bytes()).is_ok();
        drop(w);
        drop(s);
        let _ = self.event_tx.send(AgentEvent::Status {
            id: id.to_string(),
            status: AgentStatus::Working,
        });
        ok
    }

    pub fn send_task(&self, id: &str, task: &str) -> bool {
        self.send_input(id, &(task.to_string() + "\n"))
    }

    pub fn stop_agent(&self, id: &str) -> bool {
        let mut s = self.agents.lock().unwrap();
        let Some(ag) = s.get_mut(id) else {
            return false;
        };
        if let Some(c) = &ag.child {
            let mut g = c.lock().unwrap();
            let _ = g.kill();
        }
        ag.writer = None;
        ag.child = None;
        ag.status = AgentStatus::Idle;
        true
    }

    pub fn remove_agent(&self, id: &str) -> bool {
        self.stop_agent(id);
        self.agents.lock().unwrap().remove(id).is_some()
    }

    pub fn get_agent_list(&self) -> Vec<AgentJson> {
        self.agents
            .lock()
            .unwrap()
            .iter()
            .map(|(id, a)| AgentJson {
                id: id.clone(),
                name: a.name.clone(),
                agent_type: a.agent_type.clone(),
                status: a.status.clone(),
                command: a.command.clone(),
            })
            .collect()
    }
}

impl Default for AgentManager {
    fn default() -> Self {
        Self::new()
    }
}
