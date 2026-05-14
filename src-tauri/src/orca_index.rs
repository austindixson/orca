//! SQLite FTS5 index for `~/.orca/session-index.sqlite`.

use rusqlite::{params, Connection};
use serde::Serialize;
use std::fs;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaSearchRow {
    pub session_id: String,
    pub message_index: i64,
    pub content: String,
    /// FTS5 BM25 relevance (higher = better match for the same query).
    pub bm25: f64,
}

fn db_path() -> Result<std::path::PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home directory".to_string())?;
    let root = home.join(".orca");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root.join("session-index.sqlite"))
}

fn open_conn() -> Result<Connection, String> {
    let path = db_path()?;
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
            session_id UNINDEXED,
            message_index UNINDEXED,
            content
        );
    "#,
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
pub fn orca_index_upsert_message(
    session_id: String,
    message_index: i64,
    content: String,
) -> Result<(), String> {
    let conn = open_conn()?;
    conn.execute(
        "DELETE FROM session_messages_fts WHERE session_id = ?1 AND message_index = ?2",
        params![session_id, message_index],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO session_messages_fts(session_id, message_index, content) VALUES (?1, ?2, ?3)",
        params![session_id, message_index, content],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Escape double-quotes for FTS5 query string (phrase search).
fn fts5_escape_query(q: &str) -> String {
    let t = q.trim();
    if t.is_empty() {
        return String::new();
    }
    // Wrap in quotes and escape internal quotes
    format!("\"{}\"", t.replace('"', "\"\""))
}

#[tauri::command]
pub fn orca_index_search(query: String, limit: i64) -> Result<Vec<OrcaSearchRow>, String> {
    let conn = open_conn()?;
    let q = fts5_escape_query(&query);
    if q.is_empty() {
        return Ok(vec![]);
    }
    let lim = limit.clamp(1, 100);
    let sql = format!(
        "SELECT session_id, message_index, content, bm25(session_messages_fts) AS s FROM session_messages_fts WHERE session_messages_fts MATCH ?1 ORDER BY s DESC LIMIT {}",
        lim
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![q], |row| {
            Ok(OrcaSearchRow {
                session_id: row.get(0)?,
                message_index: row.get(1)?,
                content: row.get(2)?,
                bm25: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| e.to_string())?);
    }
    Ok(out)
}
