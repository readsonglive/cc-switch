import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";
import { useSettingsQuery } from "@/lib/query";
import type { Settings } from "@/types";
import type { UpdateInfo } from "../lib/updater";
import { checkForUpdate } from "../lib/updater";
import { extractErrorMessage } from "../utils/errorUtils";

/**
 * 计算下一个自动检查更新的触发时间（毫秒时间戳）。
 * - yearly: 指定月/日的 00:00:00（当年若未到则用当年，否则次年）
 * - hourly/daily/weekly: 指定时刻 HH:mm:ss；hourly/daily 取当天/次日，weekly 取当周/下周
 * - frequency 为空（manual）返回 null
 */
export function computeNextCheckTime(
  s: Pick<
    Settings,
    "updateCheckFrequency" | "updateCheckTime" | "updateCheckMonth" | "updateCheckDay"
  >,
  now: Date,
): number | null {
  const freq = s.updateCheckFrequency;
  if (!freq) return null;

  if (freq === "yearly") {
    const month = Math.min(12, Math.max(1, s.updateCheckMonth ?? 1));
    const day = Math.min(31, Math.max(1, s.updateCheckDay ?? 1));
    // 该年该月该日（若无效则顺延到该月最大天数）
    const candidate = new Date(now.getFullYear(), month - 1, day);
    const target = candidate.getTime() > now.getTime() ? candidate : null;
    if (target) return target.getTime();
    return new Date(now.getFullYear() + 1, month - 1, day).getTime();
  }

  // 解析 HH:mm:ss
  const m = /^(?:(\d{1,2}):)?(?:(\d{1,2}):)?(\d{1,2})$/.exec(
    s.updateCheckTime ?? "",
  );
  const hour = m?.[1] != null ? Math.min(23, Number(m[1])) : 0;
  const minute = m?.[2] != null ? Math.min(59, Number(m[2])) : 0;
  const second = m?.[3] != null ? Math.min(59, Number(m[3])) : 0;

  const target = new Date(now);
  target.setHours(hour, minute, second, 0);

  if (freq === "hourly") {
    // 每小时的指定 mm:ss；若当前小时已错过，滚动到下一小时（可能跨天）
    const currentHour = now.getHours();
    target.setHours(currentHour + 1, minute, second, 0);
    return target.getTime();
  }

  if (freq === "daily") {
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }

  // weekly: 每天在设定时刻都触发一次，间隔恰好 7 天（"每周同一时刻"）
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 7);
  }
  return target.getTime();
}

interface UpdateContextValue {
  // 更新状态
  hasUpdate: boolean;
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  error: string | null;

  // 提示状态
  isDismissed: boolean;
  dismissUpdate: () => void;

  // 操作方法
  checkUpdate: () => Promise<boolean>;
  resetDismiss: () => void;
}

const UpdateContext = createContext<UpdateContextValue | undefined>(undefined);

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  const DISMISSED_VERSION_KEY = "ccswitch:update:dismissedVersion";
  const LEGACY_DISMISSED_KEY = "dismissedUpdateVersion"; // 兼容旧键

  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);

  // 从 localStorage 读取已关闭的版本
  useEffect(() => {
    const current = updateInfo?.availableVersion;
    if (!current) return;

    // 读取新键；若不存在，尝试迁移旧键
    let dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
    if (!dismissedVersion) {
      const legacy = localStorage.getItem(LEGACY_DISMISSED_KEY);
      if (legacy) {
        localStorage.setItem(DISMISSED_VERSION_KEY, legacy);
        localStorage.removeItem(LEGACY_DISMISSED_KEY);
        dismissedVersion = legacy;
      }
    }

    setIsDismissed(dismissedVersion === current);
  }, [updateInfo?.availableVersion]);

  const isCheckingRef = useRef(false);
  const { data: settingsData } = useSettingsQuery();

  const checkUpdate = useCallback(async () => {
    if (isCheckingRef.current) return false;
    isCheckingRef.current = true;
    setIsChecking(true);
    setError(null);

    try {
      const result = await checkForUpdate({ timeout: 30000 });

      if (result.status === "available") {
        setHasUpdate(true);
        setUpdateInfo(result.info);

        // 检查是否已经关闭过这个版本的提醒
        let dismissedVersion = localStorage.getItem(DISMISSED_VERSION_KEY);
        if (!dismissedVersion) {
          const legacy = localStorage.getItem(LEGACY_DISMISSED_KEY);
          if (legacy) {
            localStorage.setItem(DISMISSED_VERSION_KEY, legacy);
            localStorage.removeItem(LEGACY_DISMISSED_KEY);
            dismissedVersion = legacy;
          }
        }
        setIsDismissed(dismissedVersion === result.info.availableVersion);
        return true; // 有更新
      } else {
        setHasUpdate(false);
        setUpdateInfo(null);
        setIsDismissed(false);
        return false; // 已是最新
      }
    } catch (err) {
      console.error("检查更新失败:", err);
      setError(extractErrorMessage(err) || "检查更新失败");
      setHasUpdate(false);
      throw err; // 抛出错误让调用方处理
    } finally {
      setIsChecking(false);
      isCheckingRef.current = false;
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setIsDismissed(true);
    if (updateInfo?.availableVersion) {
      localStorage.setItem(DISMISSED_VERSION_KEY, updateInfo.availableVersion);
      // 清理旧键
      localStorage.removeItem(LEGACY_DISMISSED_KEY);
    }
  }, [updateInfo?.availableVersion]);

  const resetDismiss = useCallback(() => {
    setIsDismissed(false);
    localStorage.removeItem(DISMISSED_VERSION_KEY);
    localStorage.removeItem(LEGACY_DISMISSED_KEY);
  }, []);

  // 应用启动时自动检查更新
  useEffect(() => {
    // 延迟1秒后检查，避免影响启动体验
    const timer = setTimeout(() => {
      checkUpdate().catch(console.error);
    }, 1000);

    return () => clearTimeout(timer);
  }, [checkUpdate]);

  // 按用户配置频率周期性自动检查更新
  // 设置改变时重新调度；用 setTimeout 跳到下一个匹配时刻，触发后再调度下一次
  const freq = settingsData?.updateCheckFrequency;
  const timeKey = [
    freq,
    settingsData?.updateCheckTime,
    settingsData?.updateCheckMonth,
    settingsData?.updateCheckDay,
  ].join("|");

  useEffect(() => {
    if (!freq) return; // 手动模式：不周期检查

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout>;

    const scheduleNext = () => {
      if (cancelled) return;
      const next = computeNextCheckTime(settingsData ?? {}, new Date());
      if (next == null) return; // 配置被清空了
      const delay = Math.max(0, next - Date.now());
      timerId = setTimeout(async () => {
        try {
          await checkUpdate();
        } catch (err) {
          console.error("[UpdateContext] 周期检查更新失败:", err);
        }
        // 触发后重新调度下一次
        scheduleNext();
      }, delay);
    };

    scheduleNext();

    return () => {
      cancelled = true;
      clearTimeout(timerId);
    };
  }, [timeKey, checkUpdate]);

  const value: UpdateContextValue = {
    hasUpdate,
    updateInfo,
    isChecking,
    error,
    isDismissed,
    dismissUpdate,
    checkUpdate,
    resetDismiss,
  };

  return (
    <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
  );
}

export function useUpdate() {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error("useUpdate must be used within UpdateProvider");
  }
  return context;
}
