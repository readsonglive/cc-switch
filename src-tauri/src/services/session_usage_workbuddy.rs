//! Import WorkBuddy session token usage from its local SQLite database.
//!
//! WorkBuddy keeps per-session **cumulative** usage in
//! `<config_dir>/workbuddy.db`:
//!
//! - `sessions`      — session metadata (`id`, `model`, timestamps, cwd)
//! - `session_usage` — `used` (tokens consumed so far), `size`, `updated_at`,
//!   `credit_json` (`{<model-uuid>: <credits>}` — the app's own billing
//!   accounting, summed here as the row's cost)
//!
//! Because `used` is cumulative, each session maps to exactly one row keyed
//! by session id and is **upserted** on every sync — never appended, or a
//! long-lived session would be counted once per sync.
//!
//! Caveat: `rollup_and_prune` folds detail rows older than 30 days into
//! `usage_daily_rollups` and deletes them. A session that receives new usage
//! after its row was pruned is re-inserted from scratch, so its cumulative
//! tokens are added to the rollup a second time. The window is narrow
//! (session must be re-updated after 30 days of detail pruning); other
//! cumulative-source importers accept the same exposure.
//!
//! Read-only: the database is opened with `SQLITE_OPEN_READ_ONLY` and never
//! written to.
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::usage::calculator::CostCalculator;
use crate::proxy::usage::parser::TokenUsage;
use crate::services::session_usage::{load_sync_cursors, update_sync_state_on_conn, SessionSyncResult};
use crate::services::sql_helpers::INPUT_TOKEN_SEMANTICS_FRESH;
use crate::services::usage_stats::find_model_pricing;
use crate::workbuddy_config::database_path;
use rusqlite::{params, Connection, OpenFlags};
use rust_decimal::Decimal;
use std::collections::HashMap;

const APP_TYPE: &str = "workbuddy";
const PROVIDER_ID: &str = "_workbuddy_session";
const DATA_SOURCE: &str = "workbuddy_session";
const REQUEST_ID_PREFIX: &str = "workbuddy_session:";

pub fn sync_workbuddy_usage(db: &Database) -> Result<SessionSyncResult, AppError> {
    let path = database_path();
    if !path.exists() {
        return Ok(SessionSyncResult::default());
    }
    let source = match Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(conn) => conn,
        Err(error) => {
            log::warn!(
                "[SESSION-SYNC] 无法打开 WorkBuddy 数据库 {}: {error}",
                path.display()
            );
            return Ok(SessionSyncResult::default());
        }
    };
    let key = format!("workbuddy:{}", path.display());
    sync_from_database(db, &source, &key)
}

fn sync_from_database(
    db: &Database,
    source: &Connection,
    key: &str,
) -> Result<SessionSyncResult, AppError> {
    let mut result = SessionSyncResult::default();
    let cursors = load_sync_cursors(db)?;
    let cursor = cursors.get(key).map_or(0, |c| c.last_line_offset.max(0));

    if !table_exists(source, "session_usage")? {
        // 旧版 WorkBuddy 没有用量表：不是错误，只是没有可导入的数据
        return Ok(result);
    }

    let mut query = source.prepare(
        "SELECT u.session_id, u.used, u.updated_at, u.credit_json,
                CASE WHEN EXISTS (SELECT 1 FROM sqlite_master WHERE name = 'sessions')
                     THEN (SELECT COALESCE(NULLIF(s.model, ''), 'unknown') FROM sessions s
                           WHERE s.id = u.session_id)
                     ELSE 'unknown' END
         FROM session_usage u WHERE u.updated_at > ?1 ORDER BY u.updated_at",
    )?;
    let mut rows = query.query(params![cursor])?;
    result.files_scanned = 1;

    let mut conn = lock_conn!(db.conn);
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Database(format!("启动 WorkBuddy 用量导入事务失败: {e}")))?;
    // 模型 → 本地定价算出的总价（仅无积分账时用到）；未命中也缓存，避免每会话重查。
    let mut pricing_cache: HashMap<String, Option<Decimal>> = HashMap::new();
    let mut max_updated_at = cursor;
    let mut imported = 0u32;

    while let Some(row) = rows.next()? {
        let session_id: String = row.get(0)?;
        let used: i64 = row.get(1)?;
        let updated_at: i64 = row.get(2)?;
        let credit_json: Option<String> = row.get(3)?;
        let model: String = row.get(4)?;

        let input_tokens = used.clamp(0, u32::MAX as i64) as u32;
        let usage = TokenUsage {
            input_tokens,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_creation_tokens: 0,
            cache_creation_1h_tokens: 0,
            model: Some(model.clone()),
            message_id: None,
        };

        // 优先用 WorkBuddy 自己的积分账（native cost，与 MCode 同例）；
        // 没有积分记录时回落到本地模型定价。
        let native_cost = credit_json.as_deref().map(sum_credits);
        let (input_cost, total_cost) = match native_cost {
            Some(cost) if cost.is_finite() && cost >= 0.0 => {
                (cost.to_string(), cost.to_string())
            }
            _ => {
                let entry = pricing_cache.entry(model.clone()).or_insert_with(|| {
                    find_model_pricing(&tx, &model).and_then(|pricing| {
                        CostCalculator::calculate_for_app(APP_TYPE, &usage, &pricing, Decimal::ONE)
                            .total_cost
                            .to_string()
                            .parse()
                            .ok()
                    })
                });
                let priced = *entry;
                match priced {
                    Some(cost) => (cost.to_string(), cost.to_string()),
                    None => ("0".to_string(), "0".to_string()),
                }
            }
        };

        let request_id = format!("{REQUEST_ID_PREFIX}{session_id}");
        let changed = tx.execute(
            "INSERT INTO proxy_request_logs (
                request_id, provider_id, app_type, model, request_model,
                input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd,
                total_cost_usd, latency_ms, status_code, session_id, provider_type,
                is_streaming, cost_multiplier, created_at, data_source, input_token_semantics
             ) VALUES (?1, ?2, ?3, ?4, ?4, ?5, 0, 0, 0, ?6, '0', '0', '0', ?7,
                       0, 200, ?8, ?9, 1, '1', ?10, ?11, ?12)
             ON CONFLICT(request_id) DO UPDATE SET
                model = excluded.model,
                input_tokens = excluded.input_tokens,
                input_cost_usd = excluded.input_cost_usd,
                total_cost_usd = excluded.total_cost_usd,
                session_id = excluded.session_id,
                created_at = excluded.created_at",
            params![
                request_id,
                PROVIDER_ID,
                APP_TYPE,
                model,
                input_tokens,
                input_cost,
                total_cost,
                session_id,
                DATA_SOURCE,
                updated_at / 1000,
                DATA_SOURCE,
                INPUT_TOKEN_SEMANTICS_FRESH,
            ],
        )?;
        imported += changed as u32;
        max_updated_at = max_updated_at.max(updated_at);
    }

    // 游标（max updated_at）与数据同事务提交：失败的轮次不留半截游标。
    update_sync_state_on_conn(&tx, key, 0, max_updated_at)?;
    tx.commit()
        .map_err(|e| AppError::Database(format!("提交 WorkBuddy 用量导入事务失败: {e}")))?;

    result.imported = imported;
    if imported > 0 {
        log::info!(
            "[SESSION-SYNC] WorkBuddy 同步完成: 导入 {} 条会话用量",
            imported
        );
    }
    Ok(result)
}

fn table_exists(source: &Connection, name: &str) -> Result<bool, AppError> {
    let count: i64 = source
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            params![name],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Database(format!("查询 WorkBuddy 表失败: {e}")))?;
    Ok(count > 0)
}

/// `credit_json` 形如 `{"<model-uuid>": 6.28, ...}`，求和得会话总积分。
/// 解析失败或含非有限/负值时逐项跳过；全跳过多为 null。
fn sum_credits(credit_json: &str) -> f64 {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(credit_json) else {
        return 0.0;
    };
    let Some(map) = value.as_object() else {
        return 0.0;
    };
    map.values()
        .filter_map(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source_db() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = Connection::open(dir.path().join("workbuddy.db")).unwrap();
        conn.execute_batch(
            "CREATE TABLE sessions (id TEXT PRIMARY KEY, model TEXT, created_at INTEGER, updated_at INTEGER);
             CREATE TABLE session_usage (session_id TEXT PRIMARY KEY, used INTEGER NOT NULL,
                 size INTEGER NOT NULL, updated_at INTEGER NOT NULL, credit_json TEXT);
             INSERT INTO sessions VALUES ('s1','hy3',1000,1500),('s2',NULL,2000,2500);
             INSERT INTO session_usage VALUES ('s1',1000,192000,1500,'{\"m-a\":1.5,\"m-b\":2.5}');
             INSERT INTO session_usage VALUES ('s2',500,262144,2500,NULL);",
        )
        .unwrap();
        (dir, conn)
    }

    #[test]
    fn workbuddy_imports_session_usage_and_upserts_cumulative_values() {
        let (dir, source) = source_db();
        let db = Database::memory().unwrap();
        let key = format!("workbuddy:{}", dir.path().join("workbuddy.db").display());

        let result = sync_from_database(&db, &source, &key).unwrap();
        assert_eq!(result.imported, 2);

        {
            let conn = db.conn.lock().unwrap();
            let (input, cost, model, created_at): (i64, String, String, i64) = conn
                .query_row(
                    "SELECT input_tokens, total_cost_usd, model, created_at
                     FROM proxy_request_logs WHERE request_id = 'workbuddy_session:s1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .unwrap();
            assert_eq!(input, 1000);
            assert_eq!(cost, "4"); // 1.5 + 2.5
            assert_eq!(model, "hy3");
            assert_eq!(created_at, 1); // 1500ms → 1s

            let s2: (i64, String, String) = conn
                .query_row(
                    "SELECT input_tokens, total_cost_usd, model
                     FROM proxy_request_logs WHERE request_id = 'workbuddy_session:s2'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .unwrap();
            assert_eq!(s2, (500, "0".into(), "unknown".into()));
        }

        // 无新数据：游标挡住，不重复导入
        assert_eq!(
            sync_from_database(&db, &source, &key)
                .unwrap()
                .imported,
            0
        );

        // 会话累计值增长：upsert 更新原行，不新增行
        source
            .execute(
                "UPDATE session_usage SET used = 1500, updated_at = 3500 WHERE session_id = 's1'",
                [],
            )
            .unwrap();
        assert_eq!(
            sync_from_database(&db, &source, &key)
                .unwrap()
                .imported,
            1
        );

        let conn = db.conn.lock().unwrap();
        let (input, count): (i64, i64) = conn
            .query_row(
                "SELECT input_tokens,
                        (SELECT COUNT(*) FROM proxy_request_logs WHERE app_type = 'workbuddy')
                 FROM proxy_request_logs WHERE request_id = 'workbuddy_session:s1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(input, 1500);
        assert_eq!(count, 2);
    }

    #[test]
    fn workbuddy_missing_usage_table_is_a_noop() {
        let dir = tempfile::tempdir().unwrap();
        let source = Connection::open(dir.path().join("workbuddy.db")).unwrap();
        let db = Database::memory().unwrap();
        let result = sync_from_database(&db, &source, "workbuddy:test").unwrap();
        assert_eq!(result.imported, 0);
        assert_eq!(result.files_scanned, 0);
    }
}
