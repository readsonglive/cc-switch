//! Import CodeBuddy CLI session logs into the usage database.
//!
//! CodeBuddy's CLI writes Claude-compatible transcripts under
//! `<config_dir>/projects/<project-hash>/*.jsonl` (plus the same
//! `subagents/` nesting Claude Code uses). Assistant lines carry
//! `message.usage` in Anthropic shape, so `input_tokens` is fresh input
//! (cache reads counted separately) — same semantics as the Claude path.
//!
//! ## 数据流
//! ```text
//! ~/.codebuddy/projects/*/*.jsonl → 增量解析 → proxy_request_logs
//! ```
//!
//! 与 Claude 路径的差别：不做请求耗时估算（CodeBuddy 的行没有
//! `apiBlockIndex`/`thinkingDurationMs` 这类计时线索），游标只用
//! 「mtime + 字节偏移」，不写尾部指纹。文件被外部截断时游标钉到 EOF、
//! 不重放旧区间（同 Claude 路径的双算防护，见 `session_usage.rs` 文档）。
use crate::codebuddy_config::get_codebuddy_config_dir;
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::usage::calculator::{CostCalculator, ModelPricing};
use crate::proxy::usage::parser::{claude_cache_creation_1h_tokens, TokenUsage};
use crate::services::session_usage::{
    load_sync_cursors, metadata_modified_nanos, parse_timestamp_millis, update_sync_state_on_conn,
    SessionSyncResult, SyncCursor,
};
use crate::services::sql_helpers::INPUT_TOKEN_SEMANTICS_FRESH;
use crate::services::usage_stats::find_model_pricing;
use rusqlite::params;
use rust_decimal::Decimal;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

const APP_TYPE: &str = "codebuddy";
const PROVIDER_ID: &str = "_codebuddy_session";
const DATA_SOURCE: &str = "codebuddy_session";
const REQUEST_ID_PREFIX: &str = "codebuddy_session:";

/// 从 JSONL 里解析出的 assistant 消息用量（按 message.id 去重后的代表行）。
struct ParsedUsage {
    message_id: String,
    model: String,
    input_tokens: u32,
    output_tokens: u32,
    cache_read_tokens: u32,
    cache_creation_tokens: u32,
    cache_creation_1h_tokens: u32,
    /// RFC3339 时间戳（秒级 created_at 由它换算）。
    timestamp: Option<String>,
    session_id: Option<String>,
}

pub fn sync_codebuddy_usage(db: &Database) -> Result<SessionSyncResult, AppError> {
    let projects_dir = get_codebuddy_config_dir().join("projects");
    if !projects_dir.exists() {
        return Ok(SessionSyncResult::default());
    }

    let mut result = SessionSyncResult::default();
    let jsonl_files = collect_jsonl_files(&projects_dir);
    let cursors = load_sync_cursors(db)?;

    for file_path in &jsonl_files {
        result.files_scanned += 1;
        match sync_single_file(db, file_path, cursors.get(file_path.to_string_lossy().as_ref())) {
            Ok(file_sync) => {
                result.imported += file_sync.imported;
                result.skipped += file_sync.skipped;
            }
            Err(error) => {
                let msg = format!("{}: {error}", file_path.display());
                log::warn!("[SESSION-SYNC] CodeBuddy 文件解析失败: {msg}");
                result.errors.push(msg);
            }
        }
    }

    if result.imported > 0 {
        log::info!(
            "[SESSION-SYNC] CodeBuddy 同步完成: 导入 {} 条, 跳过 {} 条, 扫描 {} 个文件",
            result.imported,
            result.skipped,
            result.files_scanned
        );
    }

    Ok(result)
}

/// 收集 `<projects_dir>/<项目>/*.jsonl` 与子 agent 转录（固定深度，不递归）。
///
/// 布局与 Claude Code 一致：
///   projects/<项目>/*.jsonl                                      主会话
///   projects/<项目>/<SESSION_ID>/subagents/*.jsonl               子 agent
///   projects/<项目>/<SESSION_ID>/subagents/workflows/wf_*/*.jsonl Workflow 子 agent
fn collect_jsonl_files(projects_dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(projects_dir) else {
        return files;
    };
    for entry in entries.flatten() {
        let project_dir = entry.path();
        if !project_dir.is_dir() {
            continue;
        }
        let Ok(sub_entries) = fs::read_dir(&project_dir) else {
            continue;
        };
        for sub_entry in sub_entries.flatten() {
            let sub_path = sub_entry.path();
            if sub_path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                files.push(sub_path);
            } else if sub_path.is_dir() {
                let subagents_dir = sub_path.join("subagents");
                if subagents_dir.is_dir() {
                    push_jsonl_children(&subagents_dir, &mut files);
                    let workflows_dir = subagents_dir.join("workflows");
                    if workflows_dir.is_dir() {
                        if let Ok(wf_entries) = fs::read_dir(&workflows_dir) {
                            for wf_entry in wf_entries.flatten() {
                                let wf_path = wf_entry.path();
                                if wf_path.is_dir() {
                                    push_jsonl_children(&wf_path, &mut files);
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    files
}

fn push_jsonl_children(dir: &Path, files: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                files.push(path);
            }
        }
    }
}

#[derive(Debug, Default)]
struct FileSync {
    imported: u32,
    skipped: u32,
}

/// 增量同步单个 JSONL 文件。
///
/// 游标是字节偏移（`last_byte_offset`，经 [`SyncCursor`] 读取）；文件未变化
/// （mtime 未前进）时直接跳过。偏移超过文件大小视为外部截断：游标钉到当前
/// EOF、不重放旧区间——明细被 `rollup_and_prune` 剪掉后重放会二次累加进汇总。
fn sync_single_file(
    db: &Database,
    file_path: &Path,
    cursor: Option<&SyncCursor>,
) -> Result<FileSync, AppError> {
    let file_path_str = file_path.to_string_lossy().to_string();
    let metadata = fs::metadata(file_path)
        .map_err(|e| AppError::Config(format!("无法读取文件元数据: {e}")))?;
    let file_modified = metadata_modified_nanos(&metadata);
    let file_size = metadata.len() as i64;

    let last_modified = cursor.map_or(0, |c| c.last_modified);
    if file_modified <= last_modified {
        return Ok(FileSync::default());
    }

    let mut file =
        fs::File::open(file_path).map_err(|e| AppError::Config(format!("无法打开文件: {e}")))?;

    let start_offset = match cursor.and_then(|c| c.last_byte_offset) {
        Some(offset) if offset > file_size => {
            // 截断/替换：不重放，游标钉到 EOF
            log::warn!(
                "[SESSION-SYNC] CodeBuddy 文件被外部截断，游标钉至 EOF、不重放旧区间: {}",
                file_path.display()
            );
            let conn = lock_conn!(db.conn);
            update_sync_state_on_conn(&conn, &file_path_str, file_modified, file_size)?;
            return Ok(FileSync::default());
        }
        Some(offset) => offset,
        None => 0,
    };
    if start_offset > 0 {
        file.seek(SeekFrom::Start(start_offset as u64))
            .map_err(|e| AppError::Config(format!("无法定位文件偏移: {e}")))?;
    }

    // 只推进到最后一个完整行（以 \n 结尾）之后：写入方可能正在追加半行，
    // 越过它会把补全后的同一行漏掉。用 read_until 精确计字节（兼容 \r\n）。
    let mut committed_offset = start_offset;
    let mut messages: HashMap<String, ParsedUsage> = HashMap::new();
    let mut current_session_id: Option<String> = None;
    let mut reader = BufReader::new(file);
    let mut buf: Vec<u8> = Vec::new();

    loop {
        buf.clear();
        let read = match reader.read_until(b'\n', &mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => break,
        };
        if !buf.ends_with(b"\n") {
            // 尾部残段（写入方可能正在追加）：不越过它
            break;
        }
        committed_offset += read as i64;

        let Ok(line) = std::str::from_utf8(&buf) else {
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        if current_session_id.is_none() {
            if let Some(sid) = value.get("sessionId").and_then(|v| v.as_str()) {
                current_session_id = Some(sid.to_string());
            }
        }

        if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let Some(msg_id) = message.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(usage) = message.get("usage") else {
            continue;
        };

        let parsed = ParsedUsage {
            message_id: msg_id.to_string(),
            model: message
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
            input_tokens: usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            output_tokens: usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_read_tokens: usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_tokens: usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32,
            cache_creation_1h_tokens: claude_cache_creation_1h_tokens(usage),
            timestamp: value
                .get("timestamp")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            session_id: current_session_id.clone(),
        };

        // 同一 message.id 可能出现多块（流式分块/最终块）：保留 output 最大的
        // 代表行，request_id 去重兜底，不会双算。
        let should_replace = match messages.get(msg_id) {
            None => true,
            Some(existing) => parsed.output_tokens > existing.output_tokens,
        };
        if should_replace {
            messages.insert(msg_id.to_string(), parsed);
        }
    }

    let mut conn = lock_conn!(db.conn);
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Database(format!("启动 CodeBuddy 用量导入事务失败: {e}")))?;
    let mut pricing_cache: HashMap<String, Option<ModelPricing>> = HashMap::new();
    let mut imported = 0u32;
    let mut skipped = 0u32;

    for msg in messages.values() {
        let has_billable_tokens = msg.input_tokens > 0
            || msg.output_tokens > 0
            || msg.cache_read_tokens > 0
            || msg.cache_creation_tokens > 0;
        if !has_billable_tokens {
            continue;
        }

        let request_id = format!("{REQUEST_ID_PREFIX}{}", msg.message_id);
        let usage = TokenUsage {
            input_tokens: msg.input_tokens,
            output_tokens: msg.output_tokens,
            cache_read_tokens: msg.cache_read_tokens,
            cache_creation_tokens: msg.cache_creation_tokens,
            cache_creation_1h_tokens: msg.cache_creation_1h_tokens,
            model: Some(msg.model.clone()),
            message_id: None,
        };
        let (input_cost, output_cost, cache_read_cost, cache_creation_cost, total_cost) =
            match pricing_cache
                .entry(msg.model.clone())
                .or_insert_with(|| find_model_pricing(&tx, &msg.model))
            {
                Some(pricing) => {
                    let breakdown =
                        CostCalculator::calculate_for_app(APP_TYPE, &usage, pricing, Decimal::ONE);
                    (
                        breakdown.input_cost.to_string(),
                        breakdown.output_cost.to_string(),
                        breakdown.cache_read_cost.to_string(),
                        breakdown.cache_creation_cost.to_string(),
                        breakdown.total_cost.to_string(),
                    )
                }
                None => (
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                    "0".to_string(),
                ),
            };

        let created_at = msg
            .timestamp
            .as_deref()
            .and_then(parse_timestamp_millis)
            .map(|millis| millis / 1000)
            .unwrap_or_else(|| {
                SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_secs() as i64)
                    .unwrap_or(0)
            });

        let changed = tx.execute(
            "INSERT OR IGNORE INTO proxy_request_logs (
                request_id, provider_id, app_type, model, request_model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd,
                total_cost_usd, latency_ms, status_code, session_id, provider_type,
                is_streaming, cost_multiplier, created_at, data_source, input_token_semantics
             ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6, ?7, ?8,
                       ?9, ?10, ?11, ?12, ?13, 0, 200, ?14, ?15, 1, '1', ?16, ?17, ?18)",
            params![
                request_id,
                PROVIDER_ID,
                APP_TYPE,
                msg.model,
                msg.input_tokens,
                msg.output_tokens,
                msg.cache_read_tokens,
                msg.cache_creation_tokens,
                input_cost,
                output_cost,
                cache_read_cost,
                cache_creation_cost,
                total_cost,
                msg.session_id,
                DATA_SOURCE,
                created_at,
                DATA_SOURCE,
                INPUT_TOKEN_SEMANTICS_FRESH,
            ],
        )?;
        imported += changed as u32;
        skipped += u32::from(changed == 0);
    }

    update_sync_state_on_conn(&tx, &file_path_str, file_modified, committed_offset)?;
    tx.commit()
        .map_err(|e| AppError::Database(format!("提交 CodeBuddy 用量导入事务失败: {e}")))?;

    Ok(FileSync { imported, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use std::io::Write;

    fn write_jsonl(dir: &Path, relative: &str, lines: &[&str]) {
        let path = dir.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut file = fs::File::create(path).unwrap();
        for line in lines {
            writeln!(file, "{line}").unwrap();
        }
    }

    #[test]
    fn codebuddy_imports_assistant_usage_once_per_message() {
        let home = tempfile::tempdir().unwrap();
        let projects = home.path().join("projects");
        write_jsonl(
            &projects,
            "d-Proj/session-a.jsonl",
            &[
                r#"{"type":"session-meta","sessionId":"sess-a"}"#,
                r#"{"type":"user","sessionId":"sess-a","timestamp":"2026-10-20T10:00:00.000Z"}"#,
                r#"{"type":"assistant","sessionId":"sess-a","timestamp":"2026-10-20T10:00:05.000Z","message":{"id":"msg-1","model":"step-5-preview","usage":{"input_tokens":100,"output_tokens":20,"cache_read_input_tokens":30,"cache_creation_input_tokens":5}}}"#,
                // 同一 message.id 的中间块：output 更小，应被代表行替换逻辑忽略
                r#"{"type":"assistant","sessionId":"sess-a","timestamp":"2026-10-20T10:00:06.000Z","message":{"id":"msg-1","model":"step-5-preview","usage":{"input_tokens":100,"output_tokens":1}}}"#,
                // 无 usage 的 assistant 行：跳过
                r#"{"type":"assistant","sessionId":"sess-a","timestamp":"2026-10-20T10:00:07.000Z","message":{"id":"msg-2","model":"step-5-preview"}}"#,
            ],
        );
        write_jsonl(
            &projects,
            "d-Proj/sess-a/subagents/agent-1.jsonl",
            &[
                r#"{"type":"assistant","sessionId":"sess-a","timestamp":"2026-10-20T10:01:00.000Z","message":{"id":"sub-1","model":"step-5-preview","usage":{"input_tokens":50,"output_tokens":10}}}"#,
            ],
        );

        let db = Database::memory().unwrap();
        let result = sync_from(&db, &projects);
        assert_eq!(result.imported, 2);
        assert_eq!(result.files_scanned, 2);

        {
            let conn = db.conn.lock().unwrap();
            let (input, output, cache_read, cache_create, app, source, semantics): (
                i64,
                i64,
                i64,
                i64,
                String,
                String,
                i64,
            ) = conn
                .query_row(
                    "SELECT input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                            app_type, data_source, input_token_semantics
                     FROM proxy_request_logs WHERE request_id = 'codebuddy_session:msg-1'",
                    [],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get(4)?,
                            r.get(5)?,
                            r.get(6)?,
                        ))
                    },
                )
                .unwrap();
            assert_eq!((input, output, cache_read, cache_create), (100, 20, 30, 5));
            assert_eq!(app, "codebuddy");
            assert_eq!(source, "codebuddy_session");
            assert_eq!(semantics, INPUT_TOKEN_SEMANTICS_FRESH);
        }

        // 第二轮：无变化，不重复导入
        let result = sync_from(&db, &projects);
        assert_eq!(result.imported, 0);
    }

    #[test]
    fn codebuddy_incremental_reads_only_appended_tail() {
        let home = tempfile::tempdir().unwrap();
        let projects = home.path().join("projects");
        write_jsonl(
            &projects,
            "d-Proj/session-b.jsonl",
            &[
                r#"{"type":"session-meta","sessionId":"sess-b"}"#,
                r#"{"type":"assistant","sessionId":"sess-b","timestamp":"2026-10-20T10:00:05.000Z","message":{"id":"m1","model":"m","usage":{"input_tokens":10,"output_tokens":2}}}"#,
            ],
        );

        let db = Database::memory().unwrap();
        assert_eq!(sync_from(&db, &projects).imported, 1);

        // 追加一条（同 message.id 的新块 + 新消息）
        let session_file = projects.join("d-Proj/session-b.jsonl");
        write_jsonl(
            &projects,
            "d-Proj/session-b.jsonl",
            &[
                r#"{"type":"session-meta","sessionId":"sess-b"}"#,
                r#"{"type":"assistant","sessionId":"sess-b","timestamp":"2026-10-20T10:00:05.000Z","message":{"id":"m1","model":"m","usage":{"input_tokens":10,"output_tokens":2}}}"#,
                r#"{"type":"assistant","sessionId":"sess-b","timestamp":"2026-10-20T10:00:09.000Z","message":{"id":"m2","model":"m","usage":{"input_tokens":7,"output_tokens":3}}}"#,
            ],
        );
        // mtime 门是纳秒级，连续两次写入可能落在同一刻度；显式推future 保证门放行
        let bumped = SystemTime::now() + std::time::Duration::from_secs(5);
        fs::File::options()
            .write(true)
            .open(&session_file)
            .unwrap()
            .set_modified(bumped)
            .unwrap();

        let result = sync_from(&db, &projects);
        assert_eq!(result.imported, 1);
        let conn = db.conn.lock().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM proxy_request_logs WHERE app_type = 'codebuddy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn codebuddy_missing_projects_dir_is_a_noop() {
        let home = tempfile::tempdir().unwrap();
        let db = Database::memory().unwrap();
        let result = sync_from(&db, &home.path().join("projects"));
        assert_eq!(result.imported, 0);
        assert_eq!(result.files_scanned, 0);
    }

    /// 直接对任意 projects 目录跑同步（绕过配置目录解析，测试用）。
    fn sync_from(db: &Database, projects_dir: &Path) -> SessionSyncResult {
        let jsonl_files = collect_jsonl_files(projects_dir);
        let cursors = load_sync_cursors(&db).unwrap();
        let mut result = SessionSyncResult::default();
        for file_path in &jsonl_files {
            result.files_scanned += 1;
            let file_sync = sync_single_file(
                &db,
                file_path,
                cursors.get(file_path.to_string_lossy().as_ref()),
            )
            .unwrap();
            result.imported += file_sync.imported;
            result.skipped += file_sync.skipped;
        }
        result
    }
}
