//! Restart the Node harness child with exponential backoff.

use std::path::PathBuf;
use std::time::Duration;

use tokio::process::Command;
use tracing::{info, warn};

pub async fn run_forever(node: PathBuf, script: PathBuf, extra_env: Vec<(String, String)>) {
    let mut backoff = Duration::from_secs(1);
    const MAX_BACKOFF: Duration = Duration::from_secs(60);

    loop {
        info!(
            "[Harness] spawning {} {}",
            node.display(),
            script.display()
        );
        let mut cmd = Command::new(&node);
        cmd.arg(&script)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true);
        for (k, v) in &extra_env {
            cmd.env(k, v);
        }

        let status = match cmd.status().await {
            Ok(s) => s,
            Err(e) => {
                warn!("[Harness] failed to spawn: {}", e);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(MAX_BACKOFF);
                continue;
            }
        };

        warn!("[Harness] exited with {:?}", status.code());

        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(MAX_BACKOFF);
    }
}
