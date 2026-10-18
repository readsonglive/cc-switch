//! OpenRouter 全网榜命令：
//! - 自动探测所有已配置 OpenRouter 供应商的 API key（通过 `resolve_native_credentials`）
//! - 兜底取 `AppSettings.openrouter_api_key`
//! - 无 key → 返回 `no_key`（确定性状态，前端会给出配置引导）
//! - 有 key → 转发给 `services::fetch_model_rankings`

use crate::app_config::AppType;
use crate::commands::provider::resolve_native_credentials;
use crate::services;
use crate::services::ProviderService;
use crate::settings;
use crate::store::AppState;
use tauri::State;

#[derive(serde::Deserialize)]
pub struct GetOpenrouterRankingsArgs {
    period: String,
}

#[tauri::command]
pub async fn get_openrouter_rankings(
    state: State<'_, AppState>,
    args: GetOpenrouterRankingsArgs,
) -> Result<services::RankingsResponse, String> {
    let resolve_openrouter_key_from =
        |candidates: &[(String, String)], override_key: Option<&str>| -> Option<String> {
            for (base_url, api_key) in candidates {
                if base_url.contains("openrouter.ai") && !api_key.is_empty() {
                    return Some(api_key.clone());
                }
            }
            override_key.map(|k| k.to_string())
        };

    let mut candidates: Vec<(String, String)> = Vec::new();
    for app_type in AppType::all() {
        if let Ok(map) = ProviderService::list(state.inner(), app_type.clone()) {
            for provider in map.values() {
                candidates.push(resolve_native_credentials(&app_type, Some(provider)));
            }
        }
    }

    let key = resolve_openrouter_key_from(
        candidates.as_slice(),
        settings::get_settings().openrouter_api_key.as_deref(),
    );

    let Some(key) = key else {
        return Ok(services::RankingsResponse {
            status: "no_key".to_string(),
            message: None,
            as_of: None,
            rows: Vec::new(),
        });
    };

    services::fetch_model_rankings(&key, &args.period).await
}
