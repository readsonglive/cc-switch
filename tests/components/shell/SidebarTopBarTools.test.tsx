import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";
import type { VisibleApps } from "@/types";
import { createTestQueryClient } from "../../utils/testQueryClient";

/** 版本号那一行显示什么，由检查更新的结果决定；每个用例改这里 */
const updateState = vi.hoisted(() => ({
  hasUpdate: false,
  updateInfo: null as { availableVersion: string } | null,
  isChecking: false,
  error: null as string | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "zh", resolvedLanguage: "zh", changeLanguage: vi.fn() },
  }),
}));

vi.mock("@/contexts/UpdateContext", () => ({
  useUpdate: () => updateState,
}));

vi.mock("@/hooks/useSidebarStatus", () => ({
  useSidebarStatus: () => ({
    appStatus: () => ({ mode: "direct", alert: false }),
    todayCost: 0,
    todayTokens: 0,
    todayRequests: 0,
    todayHitRate: 0,
    authNeedsAttention: false,
  }),
}));

const COLLAPSED_KEY = "cc-switch-sidebar-collapsed";
const WIDTH_KEY = "cc-switch-sidebar-width";

const renderSidebar = () => {
  const client = createTestQueryClient();
  client.setQueryDefaults(["settings"], { staleTime: Infinity });
  client.setQueryData(["settings"], { language: "zh" });
  client.setQueryData(["app-version"], "4.0.15");
  return render(
    <QueryClientProvider client={client}>
      <Sidebar
        activeApp="claude"
        view="usage"
        visibleApps={{} as VisibleApps}
        settingsSection="general"
        onSelectApp={vi.fn()}
        onSelectPage={vi.fn()}
        onSelectSettingsSection={vi.fn()}
        onExitSettings={vi.fn()}
      />
    </QueryClientProvider>,
  );
};

const resizeHandle = () =>
  screen.getByRole("separator", { name: "nav.resizeSidebar" });

describe("侧栏顶栏右侧的工具行", () => {
  beforeEach(() => {
    localStorage.removeItem(COLLAPSED_KEY);
    localStorage.removeItem(WIDTH_KEY);
    updateState.hasUpdate = false;
    updateState.updateInfo = null;
    updateState.isChecking = false;
    updateState.error = null;
  });

  it("展开时显示版本号 + 已是最新，以及语言选择", () => {
    renderSidebar();

    const version = screen.getByRole("button", { name: "nav.openReleases" });
    expect(version).toHaveTextContent("v4.0.15");
    expect(version).toHaveTextContent("nav.latestVersion");
    expect(
      screen.getByRole("combobox", { name: "settings.language" }),
    ).toBeInTheDocument();
  });

  it("查到新版本时改显示可升级，版本号还是当前版本", () => {
    updateState.hasUpdate = true;
    updateState.updateInfo = { availableVersion: "4.0.16" };
    renderSidebar();

    const version = screen.getByRole("button", { name: "nav.openReleases" });
    expect(version).toHaveTextContent("v4.0.15");
    expect(version).toHaveTextContent("settings.updateAvailableShort");
  });

  it("没查完 / 查失败时不给「已是最新」这个结论", () => {
    updateState.error = "网络不通";
    renderSidebar();

    const version = screen.getByRole("button", { name: "nav.openReleases" });
    expect(version).toHaveTextContent("v4.0.15");
    expect(version).not.toHaveTextContent("nav.latestVersion");
  });

  it("展开时右边缘有拖拽把手，初值是当前宽度", () => {
    renderSidebar();

    const handle = resizeHandle();
    expect(handle).toHaveAttribute("aria-orientation", "vertical");
    expect(handle).toHaveAttribute("aria-valuenow", "200");
    expect(handle).toHaveAttribute("aria-valuemin", "200");
    expect(handle).toHaveAttribute("aria-valuemax", "420");
    expect(handle).toHaveAttribute("tabindex", "0");
  });

  it("收起时工具行和把手都不渲染", () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    renderSidebar();

    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "nav.openReleases" }),
    ).not.toBeInTheDocument();
  });
});
