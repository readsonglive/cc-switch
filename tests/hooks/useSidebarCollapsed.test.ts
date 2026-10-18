import { act, renderHook } from "@testing-library/react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORAGE_KEY,
  clampSidebarWidth,
  readStoredSidebarWidth,
  sidebarRailWidth,
  sidebarWidth,
  useSidebarCollapsed,
} from "@/hooks/useSidebarCollapsed";

const WIDTH_KEY = SIDEBAR_WIDTH_STORAGE_KEY;
/** 侧栏开合的持久化键（钩子内部的私有常量，测试里按字符串清） */
const COLLAPSED_KEY = "cc-switch-sidebar-collapsed";

describe("clampSidebarWidth", () => {
  it("低于下限时抬到下限", () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 1)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it("高于上限时压到上限", () => {
    expect(clampSidebarWidth(9999)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("区间内取整", () => {
    expect(clampSidebarWidth(250.6)).toBe(251);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH + 40)).toBe(
      SIDEBAR_MIN_WIDTH + 40,
    );
  });
});

describe("readStoredSidebarWidth", () => {
  // 这个键不在 setupTests 的清理名单里，必须自己清，否则会串到下一个用例
  beforeEach(() => {
    localStorage.removeItem(WIDTH_KEY);
  });

  it("没存过时用默认展开宽度", () => {
    expect(readStoredSidebarWidth()).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  it("存过时读回来", () => {
    localStorage.setItem(WIDTH_KEY, "300");
    expect(readStoredSidebarWidth()).toBe(300);
  });

  it("存的值超出区间时夹回来", () => {
    localStorage.setItem(WIDTH_KEY, "5000");
    expect(readStoredSidebarWidth()).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("存的值不是数字时回落到默认值，不抛错", () => {
    localStorage.setItem(WIDTH_KEY, "abc");
    expect(readStoredSidebarWidth()).toBe(SIDEBAR_EXPANDED_WIDTH);
  });
});

describe("sidebarWidth", () => {
  it("收起时是图标轨宽度，与用户设的展开宽度无关", () => {
    expect(sidebarWidth(true, 380)).toBe(sidebarRailWidth());
  });

  it("展开时用传入的宽度", () => {
    expect(sidebarWidth(false, 380)).toBe(380);
  });

  it("不传宽度时用默认展开宽度", () => {
    expect(sidebarWidth(false)).toBe(SIDEBAR_EXPANDED_WIDTH);
  });
});

describe("useSidebarCollapsed 调宽度", () => {
  beforeEach(() => {
    localStorage.removeItem(WIDTH_KEY);
    localStorage.removeItem(COLLAPSED_KEY);
  });

  /**
   * jsdom 里没有真正的指针事件 / 指针捕获，直接喂钩子一个长得像事件的对象：
   * 钩子只读 currentTarget / pointerId / clientX / button / preventDefault。
   */
  const pointerEvent = (
    clientX: number,
    overrides: Record<string, unknown> = {},
  ) =>
    ({
      currentTarget: { setPointerCapture: vi.fn() },
      pointerId: 1,
      button: 0,
      clientX,
      preventDefault: vi.fn(),
      ...overrides,
    }) as unknown as ReactPointerEvent<HTMLElement>;

  const keyEvent = (key: string) =>
    ({
      key,
      preventDefault: vi.fn(),
    }) as unknown as ReactKeyboardEvent<HTMLElement>;

  const setup = () => {
    const navRef = { current: document.createElement("nav") };
    return renderHook(() => useSidebarCollapsed(navRef));
  };

  it("展开时一开始就是存下来的宽度，收起时是图标轨宽度", () => {
    localStorage.setItem(WIDTH_KEY, "320");
    const { result } = setup();
    expect(result.current.width).toBe(320);

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(result.current.width).toBe(sidebarRailWidth());
  });

  it("往右拖多少就宽多少，松手才落盘", () => {
    const { result } = setup();
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);

    act(() => result.current.onResizeStart(pointerEvent(200)));
    expect(result.current.resizing).toBe(true);

    act(() => result.current.onResizeMove(pointerEvent(280)));
    expect(result.current.width).toBe(280);
    // 拖动过程中不写 localStorage，免得每帧一次
    expect(localStorage.getItem(WIDTH_KEY)).toBeNull();

    act(() => result.current.onResizeEnd(pointerEvent(280)));
    expect(result.current.resizing).toBe(false);
    expect(localStorage.getItem(WIDTH_KEY)).toBe("280");
  });

  it("拖过头夹在上下限之间", () => {
    const { result } = setup();
    act(() => result.current.onResizeStart(pointerEvent(200)));
    act(() => result.current.onResizeMove(pointerEvent(10)));
    expect(result.current.width).toBe(SIDEBAR_MIN_WIDTH);
    act(() => result.current.onResizeMove(pointerEvent(9999)));
    expect(result.current.width).toBe(SIDEBAR_MAX_WIDTH);
  });

  it("别人的指针不会带偏", () => {
    const { result } = setup();
    act(() =>
      result.current.onResizeStart(pointerEvent(200, { pointerId: 7 })),
    );
    act(() => result.current.onResizeMove(pointerEvent(400, { pointerId: 8 })));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  it("没按下就移动 / 松手不做事", () => {
    const { result } = setup();
    act(() => result.current.onResizeMove(pointerEvent(400)));
    act(() => result.current.onResizeEnd(pointerEvent(400)));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(localStorage.getItem(WIDTH_KEY)).toBeNull();
  });

  it("中间键按下的拖动忽略", () => {
    const { result } = setup();
    act(() => result.current.onResizeStart(pointerEvent(200, { button: 1 })));
    act(() => result.current.onResizeMove(pointerEvent(400)));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
  });

  it("收起状态下不许拖", () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    const { result } = setup();
    expect(result.current.collapsed).toBe(true);
    act(() => result.current.onResizeStart(pointerEvent(200)));
    act(() => result.current.onResizeMove(pointerEvent(400)));
    expect(result.current.width).toBe(sidebarRailWidth());
  });

  it("方向键一次 12px，Home / End 到头，Enter 回默认值", () => {
    const { result } = setup();
    act(() => result.current.onResizeKeyDown(keyEvent("ArrowRight")));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH + 12);
    act(() => result.current.onResizeKeyDown(keyEvent("ArrowLeft")));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
    act(() => result.current.onResizeKeyDown(keyEvent("End")));
    expect(result.current.width).toBe(SIDEBAR_MAX_WIDTH);
    act(() => result.current.onResizeKeyDown(keyEvent("Home")));
    expect(result.current.width).toBe(SIDEBAR_MIN_WIDTH);
    act(() => result.current.onResizeKeyDown(keyEvent("Enter")));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(localStorage.getItem(WIDTH_KEY)).toBe(
      String(SIDEBAR_EXPANDED_WIDTH),
    );
  });

  it("别的键不动宽度", () => {
    const { result } = setup();
    const event = keyEvent("Tab");
    act(() => result.current.onResizeKeyDown(event));
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("双击复位回默认宽度并落盘", () => {
    localStorage.setItem(WIDTH_KEY, "380");
    const { result } = setup();
    act(() => result.current.resetWidth());
    expect(result.current.width).toBe(SIDEBAR_EXPANDED_WIDTH);
    expect(localStorage.getItem(WIDTH_KEY)).toBe(
      String(SIDEBAR_EXPANDED_WIDTH),
    );
  });
});
