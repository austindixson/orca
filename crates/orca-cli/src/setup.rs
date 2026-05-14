//! Interactive `orca setup` wizard (Hermes-style).

use std::path::PathBuf;

use anyhow::Context;
use dialoguer::{theme::ColorfulTheme, Confirm, Input, Password};

use crate::config::{
    bridge_token_store_keyring, telegram_token_from_keyring, telegram_token_store_keyring,
    OrcaConfig,
};

/// Non-interactive: merge `PORT`, `WORKSPACE_ROOT`, `OPENROUTER_API_KEY`, `ORCA_MODEL`, `ORCA_LLM_BASE_URL` into config and save.
pub fn cmd_setup_defaults() -> anyhow::Result<()> {
    let mut cfg = OrcaConfig::load().unwrap_or_default();

    if let Ok(p) = std::env::var("PORT") {
        if let Ok(port) = p.trim().parse::<u16>() {
            cfg.server.port = port;
        }
    }
    if let Ok(w) = std::env::var("WORKSPACE_ROOT") {
        if !w.trim().is_empty() {
            cfg.server.workspace = Some(PathBuf::from(w.trim()));
        }
    }
    if let Ok(k) = std::env::var("OPENROUTER_API_KEY") {
        if !k.trim().is_empty() {
            cfg.llm.api_key = Some(k);
        }
    }
    if let Ok(u) = std::env::var("ORCA_LLM_BASE_URL") {
        if !u.trim().is_empty() {
            cfg.llm.base_url = Some(u);
        }
    }
    if let Ok(m) = std::env::var("ORCA_MODEL") {
        if !m.trim().is_empty() {
            cfg.llm.model = Some(m);
        }
    }

    if cfg.bridge.token.is_none() {
        let tok = uuid::Uuid::new_v4().to_string();
        cfg.bridge.token = Some(tok.clone());
        let _ = bridge_token_store_keyring(&tok);
    }

    cfg.save()?;
    println!(
        "Wrote {} (from env defaults)",
        OrcaConfig::path()?.display()
    );
    Ok(())
}

pub fn cmd_setup_interactive(
    cmd_install: impl FnOnce() -> anyhow::Result<()>,
    cmd_start: impl FnOnce() -> anyhow::Result<()>,
) -> anyhow::Result<()> {
    let theme = ColorfulTheme::default();
    println!("Orca setup — configure ~/.orca/config.toml\n");

    let mut cfg = OrcaConfig::load().unwrap_or_default();

    let default_port = cfg.server.port.to_string();
    let port_input: String = Input::with_theme(&theme)
        .with_prompt("Companion server port")
        .default(default_port)
        .interact_text()?;
    cfg.server.port = port_input.parse::<u16>().unwrap_or(3001);

    let default_ws = cfg
        .server
        .workspace
        .clone()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(|| {
            dirs::home_dir()
                .map(|h| h.join("Desktop"))
                .unwrap_or_else(|| PathBuf::from("."))
        });
    let ws: String = Input::with_theme(&theme)
        .with_prompt("Workspace root (WORKSPACE_ROOT for companion server)")
        .default(default_ws.display().to_string())
        .interact_text()?;
    let ws = ws.trim();
    if !ws.is_empty() {
        cfg.server.workspace = Some(PathBuf::from(ws));
    } else {
        cfg.server.workspace = None;
    }

    if cfg.bridge.token.is_some() {
        let keep = Confirm::with_theme(&theme)
            .with_prompt("Keep existing bridge token?")
            .default(true)
            .interact()?;
        if !keep {
            let tok = uuid::Uuid::new_v4().to_string();
            cfg.bridge.token = Some(tok.clone());
            if let Err(e) = bridge_token_store_keyring(&tok) {
                println!("Warning: could not store token in keyring ({e})");
            }
        }
    } else {
        let tok = uuid::Uuid::new_v4().to_string();
        cfg.bridge.token = Some(tok.clone());
        match bridge_token_store_keyring(&tok) {
            Ok(()) => println!("Generated bridge token (OS keyring + config)"),
            Err(e) => println!("Warning: could not store token in keyring ({e})"),
        }
    }

    let has_existing_key = cfg
        .llm
        .api_key
        .as_ref()
        .map(|s| !s.is_empty())
        .unwrap_or(false);
    let prompt_api = if has_existing_key {
        "OpenRouter / OpenAI-compatible API key (empty = keep existing in config)"
    } else {
        "OpenRouter / OpenAI-compatible API key (optional — can use OPENROUTER_API_KEY later)"
    };
    let api_key = Password::with_theme(&theme)
        .with_prompt(prompt_api)
        .allow_empty_password(true)
        .interact()?;
    if !api_key.trim().is_empty() {
        cfg.llm.api_key = Some(api_key.trim().to_string());
    }

    let base_url: String = Input::with_theme(&theme)
        .with_prompt("OpenAI-compatible base URL")
        .default(
            cfg.llm
                .base_url
                .clone()
                .unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string()),
        )
        .interact_text()?;
    if !base_url.trim().is_empty() {
        cfg.llm.base_url = Some(base_url.trim().to_string());
    }

    let model: String = Input::with_theme(&theme)
        .with_prompt("Model id")
        .default(
            cfg.llm
                .model
                .clone()
                .unwrap_or_else(|| "openai/gpt-4o-mini".to_string()),
        )
        .interact_text()?;
    if !model.trim().is_empty() {
        cfg.llm.model = Some(model.trim().to_string());
    }

    let hn = cfg
        .harness
        .node_path
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let node_path: String = Input::with_theme(&theme)
        .with_prompt("Node binary path (optional; default: node on PATH)")
        .default(hn)
        .allow_empty(true)
        .interact_text()?;
    cfg.harness.node_path = if node_path.trim().is_empty() {
        None
    } else {
        Some(PathBuf::from(node_path.trim()))
    };

    let hs = cfg
        .harness
        .script
        .as_ref()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let script: String = Input::with_theme(&theme)
        .with_prompt("Harness script path (optional; default: next to orcad)")
        .default(hs)
        .allow_empty(true)
        .interact_text()?;
    cfg.harness.script = if script.trim().is_empty() {
        None
    } else {
        Some(PathBuf::from(script.trim()))
    };

    let tg_prompt = if telegram_token_from_keyring().is_some() {
        "Telegram bot token (optional; empty = keep keyring)"
    } else {
        "Telegram bot token (optional; export ORCA_TELEGRAM_BOT_TOKEN for the daemon)"
    };
    let tg = Password::with_theme(&theme)
        .with_prompt(tg_prompt)
        .allow_empty_password(true)
        .interact()?;
    if !tg.trim().is_empty() {
        telegram_token_store_keyring(tg.trim()).context("store telegram token in keyring")?;
        println!("Telegram bot token stored in OS keyring (orca / telegram_bot_token).");
        println!(
            "Tip: orcad reads ORCA_TELEGRAM_BOT_TOKEN from the environment — add it to your \
             LaunchAgent plist or shell profile, or export before starting the daemon."
        );
    }

    cfg.save()?;
    println!("\nWrote {}", OrcaConfig::path()?.display());

    if Confirm::with_theme(&theme)
        .with_prompt("Run `orca install` (daemon registration) now?")
        .default(true)
        .interact()?
    {
        cmd_install()?;
    }

    if Confirm::with_theme(&theme)
        .with_prompt("Start daemon now?")
        .default(true)
        .interact()?
    {
        cmd_start()?;
    }

    println!("\nNext: `orca doctor` and `orca status`.");
    Ok(())
}
