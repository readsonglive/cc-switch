//! OpenRouter 全网榜（Data API）取数服务
//!
//! 只做「取数 + 校验 + 原样透出」，聚合（窗口切分、环比、作者份额）全在前端纯函数里。
//!
//! 错误通道语义（与 `services/balance.rs` 完全一致，见那边的模块级文档）：
//! - `Err(String)` = 瞬时传输失败（网络不可达/超时/读体中断）。前端 invoke reject，
//!   react-query 触发 retry 并保留上一次成功的 data（天然 keep-last-good）。
//! - `Ok` + `status != "ok"` = 确定性失败（无 key/鉴权/非 2xx/响应体非法 JSON），
//!   立即透出文案，不重试。

use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, PartialEq)]
struct RawRankingRow {
    date: String,
    #[serde(rename = "model_permaslug")]
    model_permaslug: String,
    #[serde(rename = "total_tokens")]
    total_tokens: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RankingRow {
    pub date: String,
    pub model: String,
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RankingsResponse {
    pub status: String,
    pub message: Option<String>,
    pub as_of: Option<String>,
    pub rows: Vec<RankingRow>,
}

fn make_ok(as_of: Option<String>, rows: Vec<RankingRow>) -> RankingsResponse {
    RankingsResponse {
        status: "ok".to_string(),
        message: None,
        as_of,
        rows,
    }
}

fn make_api_error(msg: String) -> RankingsResponse {
    RankingsResponse {
        status: "api_error".to_string(),
        message: Some(msg),
        as_of: None,
        rows: Vec::new(),
    }
}

/// 纯解析：喂 body，出结构。未知/缺字段按 api_error 处理。
pub fn parse_rankings(body: &serde_json::Value) -> RankingsResponse {
    let wrapped = match body.as_object() {
        Some(obj) => obj.get("data").and_then(|v| v.as_object()),
        None => None,
    };
    let data = match wrapped {
        Some(map) => match map.get("data") {
            Some(arr) => match arr.as_array() {
                Some(rows) => rows,
                None => {
                    return make_api_error(
                        "Missing or malformed `data.data` array in response body".to_string(),
                    );
                }
            },
            None => {
                return make_api_error(
                    "Missing `data.data` field in OpenRouter rankings response".to_string(),
                );
            }
        },
        None => {
            return make_api_error(
                "Missing `data` object in OpenRouter rankings response".to_string(),
            );
        }
    };

    let as_of = match body
        .get("data")
        .and_then(|v| v.get("meta"))
        .and_then(|m| m.get("as_of"))
        .and_then(|a| a.as_str())
    {
        Some(s) if !s.is_empty() => Some(s.to_string()),
        _ => None,
    };

    let mut rows = Vec::with_capacity(data.len());
    for raw in data {
        let row: RawRankingRow = match serde_json::from_value(raw.clone()) {
            Ok(r) => r,
            Err(e) => {
                return make_api_error(format!("Failed to parse ranking row: {e}"));
            }
        };
        let total_tokens = match row.total_tokens.parse::<u64>() {
            Ok(n) => n,
            Err(e) => {
                return make_api_error(format!(
                    "Bad `total_tokens` value `{}` for model `{}`: {e}",
                    row.total_tokens, row.model_permaslug
                ));
            }
        };
        rows.push(RankingRow {
            date: row.date,
            model: row.model_permaslug,
            total_tokens,
        });
    }

    make_ok(as_of, rows)
}

/// 取数：瞬时失败 Err，确定性失败 Ok(status != "ok")。
/// period 取值 `rankings-daily`（周榜 / 月榜走同一个接口，前端按日期窗口切）。
pub async fn fetch_model_rankings(api_key: &str, period: &str) -> Result<RankingsResponse, String> {
    let client = crate::proxy::http_client::get();
    let url = format!(
        "https://openrouter.ai/api/v1/{period}",
        period = if period.is_empty() {
            "rankings-daily"
        } else {
            period
        }
    );

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {api_key}"))
        .header("Accept", "application/json")
        .timeout(Duration::from_secs(20))
        .send()
        .await;

    let resp = match resp {
        Ok(r) => r,
        Err(e) => return Err(format!("Network error: {e}")),
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Ok(RankingsResponse {
            status: "unauthorized".to_string(),
            message: Some("OpenRouter API key is invalid".to_string()),
            as_of: None,
            rows: Vec::new(),
        });
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Ok(RankingsResponse {
            status: "api_error".to_string(),
            message: Some(format!("HTTP {status}: {body}")),
            as_of: None,
            rows: Vec::new(),
        });
    }

    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return Err(format!("Read body error: {e}")),
    };
    let body = match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(v) => v,
        Err(e) => {
            return Ok(RankingsResponse {
                status: "api_error".to_string(),
                message: Some(format!("Invalid JSON body: {e}")),
                as_of: None,
                rows: Vec::new(),
            });
        }
    };

    Ok(parse_rankings(&body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_rows_and_meta() {
        let response = parse_rankings(&json!({
            "data": {
                "data": [
                    { "date": "2026-10-14", "model_permaslug": "openai/gpt-4o", "total_tokens": "1234567890" },
                    { "date": "2026-10-15", "model_permaslug": "anthropic/claude", "total_tokens": "42" }
                ],
                "meta": { "as_of": "2026-10-15T00:00:00Z" }
            }
        }));

        assert_eq!(response.status, "ok");
        assert_eq!(response.as_of.as_deref(), Some("2026-10-15T00:00:00Z"));
        assert_eq!(response.rows.len(), 2);
        assert_eq!(response.rows[0].date, "2026-10-14");
        assert_eq!(response.rows[0].model, "openai/gpt-4o");
        assert_eq!(response.rows[0].total_tokens, 1234567890);
        assert_eq!(response.rows[1].total_tokens, 42);
    }

    #[test]
    fn total_tokens_comes_from_decimal_string() {
        let response = parse_rankings(&json!({
            "data": {
                "data": [{ "date": "2026-10-14", "model_permaslug": "a/b", "total_tokens": "174200000000000" }]
            }
        }));

        assert_eq!(response.status, "ok");
        assert_eq!(response.rows[0].total_tokens, 174_200_000_000_000u64);
    }

    #[test]
    fn keeps_other_row_and_variants_verbatim() {
        let response = parse_rankings(&json!({
            "data": {
                "data": [
                    { "date": "2026-10-14", "model_permaslug": "other", "total_tokens": "5" },
                    { "date": "2026-10-14", "model_permaslug": "openai/gpt-4o:free", "total_tokens": "7" }
                ]
            }
        }));

        assert_eq!(response.status, "ok");
        assert_eq!(response.rows[0].model, "other");
        assert_eq!(response.rows[1].model, "openai/gpt-4o:free");
    }

    #[test]
    fn missing_data_field_is_api_error() {
        let response = parse_rankings(&json!({}));

        assert_eq!(response.status, "api_error");
        assert!(response.message.is_some_and(|m| !m.is_empty()));
        assert!(response.rows.is_empty());
    }

    #[test]
    fn bad_token_string_is_api_error() {
        let response = parse_rankings(&json!({
            "data": {
                "data": [{ "date": "2026-10-14", "model_permaslug": "a/b", "total_tokens": "abc" }]
            }
        }));

        assert_eq!(response.status, "api_error");
        assert!(response.message.is_some_and(|m| !m.is_empty()));
        assert!(response.rows.is_empty());
    }
}
