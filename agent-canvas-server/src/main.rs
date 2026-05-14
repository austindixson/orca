//! Thin binary entry — library lives in `lib.rs` for embedding by `orcad`.

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = agent_canvas_server::ServerConfig::from_env()?;
    agent_canvas_server::run(config).await
}
