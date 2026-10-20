import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import { useTranslation } from "react-i18next";
import { HoverTip } from "@/components/ui/hover-tip";
import { useUpdate } from "@/contexts/UpdateContext";
import { settingsApi } from "@/lib/api/settings";
import { cn } from "@/lib/utils";

declare const __BUILD_DATE__: string;

/** GitHub 最新发布页链接 */
const RELEASES_URL = "https://github.com/farion1231/cc-switch/releases/latest";

/** 构建人（本 fork 的维护者） */
const BUILD_AUTHOR = "readsonglive";

/** update=查到新版本；latest=查过且没新版本；null=还不知道（没查完 / 查失败了）。 */
export type VersionStatus = "update" | "latest" | null;

/**
 * 版本号后面那句状态。
 * 检查更新失败时 hasUpdate 也是 false（见 UpdateContext），所以不能只看它，
 * 还要排除「正在查」和「查出错」这两种情况，否则离线时会谎称「已是最新」。
 */
export function versionStatus(state: {
  hasUpdate: boolean;
  isChecking: boolean;
  error: unknown;
}): VersionStatus {
  if (state.hasUpdate) return "update";
  if (state.isChecking || state.error) return null;
  return "latest";
}

/**
 * 侧栏顶栏的版本号：显示当前版本 + 是否已是最新，点击打开 GitHub 最新发布页。
 */
export function VersionBadge({ version }: { version?: string }) {
  const { t } = useTranslation();
  const { data: queriedVersion } = useQuery({
    queryKey: ["app-version"],
    queryFn: () => getVersion(),
    staleTime: Infinity,
  });
  const { hasUpdate, updateInfo, isChecking, error } = useUpdate();
  const displayVersion = version ?? queriedVersion;
  if (!displayVersion) return null;

  const status = versionStatus({ hasUpdate, isChecking, error });
  const openReleases = t("nav.openReleases");
  const tip =
    status === "update"
      ? t("settings.updateAvailable", {
          version: updateInfo?.availableVersion ?? "",
        })
      : error
        ? t("settings.checkUpdateFailed")
        : openReleases;
  const statusLabel =
    status === "update"
      ? t("settings.updateAvailableShort")
      : status === "latest"
        ? t("nav.latestVersion")
        : null;

  return (
    <HoverTip content={tip} side="left" disableHoverableContent>
      <button
        type="button"
        onClick={() =>
          void settingsApi.openExternal(RELEASES_URL).catch((openError) => {
            console.warn("[VersionBadge] 打开发布页失败", openError);
          })
        }
        aria-label={openReleases}
        className={cn(
          "flex h-7 items-center gap-1 rounded-control px-1 text-badge tabular-nums transition-colors",
          status === "update"
            ? "text-action-text hover:text-action-hover"
            : "text-fg-3 hover:text-fg-1",
        )}
      >
        <span>v{displayVersion}</span>
        {statusLabel && (
          <span className={status === "update" ? "font-medium" : "opacity-80"}>
            · {statusLabel}
          </span>
        )}
        <span className="opacity-60">
          · {__BUILD_DATE__} · {BUILD_AUTHOR}
        </span>
      </button>
    </HoverTip>
  );
}
