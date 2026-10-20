//! CodeBuddy CLI 的数据目录解析。
//!
//! CodeBuddy 的 CLI 与 Claude Code 共用同一套会话日志布局：
//! `<config_dir>/projects/<项目哈希>/*.jsonl`，行格式（`type=assistant` +
//! `message.usage`）也与 Claude Code 一致，因此用量导入直接复用该格式解析。
//! 目录可用 `CODEBUDDY_CONFIG_DIR` 覆盖（测试与便携场景）。
use crate::config::get_home_dir;
use std::path::PathBuf;

pub(crate) fn get_codebuddy_config_dir() -> PathBuf {
    explicit_dir(std::env::var("CODEBUDDY_CONFIG_DIR").ok().as_deref())
        .unwrap_or_else(|| get_home_dir().join(".codebuddy"))
}

fn explicit_dir(value: Option<&str>) -> Option<PathBuf> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codebuddy_config_dir_precedence_and_blank_values() {
        assert_eq!(explicit_dir(Some(" /primary ")), Some("/primary".into()));
        assert_eq!(explicit_dir(Some(" \t")), None);
        assert_eq!(explicit_dir(Some("")), None);
        assert_eq!(explicit_dir(None), None);
    }
}
