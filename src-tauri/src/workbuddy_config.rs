//! WorkBuddy 的数据目录解析。
//!
//! WorkBuddy 把会话与用量写进 `<config_dir>/workbuddy.db`（SQLite）：
//! `sessions` 表记录会话元信息（模型、时间戳），`session_usage` 表按会话
//! 累计 token 用量与积分。目录可用 `WORKBUDDY_CONFIG_DIR` 覆盖。
use crate::config::get_home_dir;
use std::path::PathBuf;

pub(crate) fn get_workbuddy_config_dir() -> PathBuf {
    explicit_dir(std::env::var("WORKBUDDY_CONFIG_DIR").ok().as_deref())
        .unwrap_or_else(|| get_home_dir().join(".workbuddy"))
}

/// WorkBuddy 用量数据库路径。
pub(crate) fn database_path() -> PathBuf {
    get_workbuddy_config_dir().join("workbuddy.db")
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
    fn workbuddy_config_dir_precedence_and_blank_values() {
        assert_eq!(explicit_dir(Some(" /primary ")), Some("/primary".into()));
        assert_eq!(explicit_dir(Some(" \t")), None);
        assert_eq!(explicit_dir(Some("")), None);
        assert_eq!(explicit_dir(None), None);
    }
}
