import { describe, expect, it } from "vitest";
import { versionStatus } from "@/components/shell/VersionBadge";

describe("versionStatus", () => {
  it("查到新版本时是 update", () => {
    expect(
      versionStatus({ hasUpdate: true, isChecking: false, error: null }),
    ).toBe("update");
  });

  it("查完并且没有新版本时是 latest", () => {
    expect(
      versionStatus({ hasUpdate: false, isChecking: false, error: null }),
    ).toBe("latest");
  });

  it("还在检查中时不表态", () => {
    expect(
      versionStatus({ hasUpdate: false, isChecking: true, error: null }),
    ).toBeNull();
  });

  it("检查失败时不谎称已是最新", () => {
    expect(
      versionStatus({
        hasUpdate: false,
        isChecking: false,
        error: "检查更新失败",
      }),
    ).toBeNull();
  });

  it("查到新版本时报 update，哪怕同时还留着上一次的错误", () => {
    expect(
      versionStatus({ hasUpdate: true, isChecking: false, error: "旧错误" }),
    ).toBe("update");
  });
});
