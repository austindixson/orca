//! `orcad` — supervises the Rust companion server and (optionally) the headless Node harness.

mod config;
mod harness_supervisor;
mod paths;

use std::path::PathBuf;

use agent_canvas_server::ServerConfig;
use anyhow::Context;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::config::OrcaConfig;
use crate::paths::{ensure_log_dir, resolve_harness_script};

struct Args {
    supervise: bool,
}

impl Args {
    fn parse() -> Self {
        let supervise = std::env::args().any(|a| a == "--supervise");
        Self { supervise }
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let cfg = OrcaConfig::load_or_default().merge_env();

    let log_dir = ensure_log_dir().context("create log dir")?;
    let log_file = log_dir.join("orcad.log");

    let file_appender = tracing_appender::rolling::never(&log_dir, "orcad.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        EnvFilter::new(format!(
            "orca_daemon=info,agent_canvas_server=info,tower_http=info,{}",
            cfg.daemon.log_level
        ))
    });

    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .with(fmt::layer().with_writer(non_blocking))
        .init();

    std::mem::forget(guard);

    if !args.supervise {
        tracing::info!(
            "orcad: pass --supervise to run the daemon (see `orca install` from orca CLI)"
        );
        tracing::info!("Logs also written to {}", log_file.display());
        return Ok(());
    }

    let workspace = cfg
        .server
        .workspace
        .clone()
        .or_else(|| std::env::current_dir().ok())
        .context("workspace")?;

    let server_cfg = ServerConfig {
        workspace,
        bridge_token: cfg.bridge.token.clone(),
        port: cfg.server.port,
        init_tracing: false,
        supervised_by_daemon: true,
    };

    let harness_script = resolve_harness_script(cfg.harness.script.clone());
    let node: Option<PathBuf> = cfg
        .harness
        .node_path
        .clone()
        .or_else(|| which::which("node").ok())
        .filter(|p| p.exists());

    let port = server_cfg.port;
    let token = cfg.bridge.token.clone().unwrap_or_default();

    tracing::info!("Starting agent-canvas-server on port {}", port);
    let server_task = tokio::spawn(async move {
        agent_canvas_server::run(server_cfg).await
    });

    if let (Some(n), Some(s)) = (node, harness_script) {
        let extra_env = vec![
            ("ORCA_BRIDGE_PORT".into(), port.to_string()),
            ("PORT".into(), port.to_string()),
            ("CANVAS_BRIDGE_TOKEN".into(), token),
        ];
        let script_display = s.display().to_string();
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        tokio::spawn(async move {
            harness_supervisor::run_forever(n, s, extra_env).await;
        });
        tracing::info!("[Harness] supervisor started for {}", script_display);
    } else {
        tracing::warn!(
            "[Harness] skipped — set harness.script in ~/.orca/config.toml or ORCA_HARNESS_SCRIPT, and ensure `node` is on PATH"
        );
    }

    server_task.await??;
    Ok(())
}
