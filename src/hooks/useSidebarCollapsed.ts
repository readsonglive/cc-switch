import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { isMac } from "@/lib/platform";

/** 窗口窄于这个宽度时侧栏自动收成图标轨（用户手动选过就按手动的来）。 */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 960;

const STORAGE_KEY = "cc-switch-sidebar-collapsed";

export const SIDEBAR_EXPANDED_WIDTH = 200;
/** 展开宽度的可调范围：窄于下限，顶栏那条工具行（版本号 + 语言选择）就放不开；宽于上限内容区太挤。 */
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
/** 用户拖出来的展开宽度；收起时的图标轨宽度固定，不受它影响。 */
export const SIDEBAR_WIDTH_STORAGE_KEY = "cc-switch-sidebar-width";
/** 收起时的图标轨宽度：macOS 的红绿灯（新版更大）要约 74px，Mac 上放宽到 84 */
export const sidebarRailWidth = () => (isMac() ? 84 : 72);

export const clampSidebarWidth = (value: number): number =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));

/** 读用户拖出来的展开宽度；没存过、或存的值坏了，就用默认值。 */
export function readStoredSidebarWidth(): number {
  try {
    const saved = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!saved) return SIDEBAR_EXPANDED_WIDTH;
    const parsed = Number(saved);
    return Number.isFinite(parsed)
      ? clampSidebarWidth(parsed)
      : SIDEBAR_EXPANDED_WIDTH;
  } catch {
    return SIDEBAR_EXPANDED_WIDTH;
  }
}

/** 只在拖完 / 键盘调整完时写：拖动过程中每一帧都写 localStorage 会卡手。 */
function writeStoredSidebarWidth(width: number) {
  try {
    localStorage.setItem(
      SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSidebarWidth(width)),
    );
  } catch {
    // 记不住也不影响这次调整
  }
}

const TOGGLE_DURATION_MS = 200;
const TOGGLE_EASING = "cubic-bezier(0.2, 0, 0, 1)";
/** 聚焦把手后按方向键每次调的宽度 */
const RESIZE_KEY_STEP = 12;
let running: {
  animation: Animation;
  cover: HTMLElement;
  edge: () => number;
} | null = null;

/**
 * 侧栏开合不过渡 width：宽度动画每帧都要在主线程重排，WKWebView 主线程渲染还限在 60fps 左右，ProMotion 屏上看着发顿。
 * 改成侧栏和内容区一步排到最终宽度（只排一次），再用一块盖板的 transform 动画画出「侧栏边缘在动」——
 * transform 交给合成器跑，能跟上 120Hz。盖板插在侧栏和内容区之间，宽度是两种侧栏宽度之差：
 * - 展开：盖板是内容区底色，先挡住侧栏多出来的那段，往右滑进内容区底下，把侧栏露出来；
 * - 收起：盖板是侧栏底色，先挡住内容区左边那段，往左滑进侧栏底下，把内容露出来。
 * 盖板的边就是这段时间的分隔线。
 */
function animateToggle(nav: HTMLElement, fromWidth: number, toWidth: number) {
  const main = document.getElementById("content-area");
  if (!main || typeof main.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  // 上一次还没滑完就再切：从当前看到的边缘位置接着滑，不跳
  const startEdge = running ? running.edge() : fromWidth;
  if (running) {
    // cancel 事件是异步派发的，旧盖板和层级在这里同步收拾掉，免得它晚到时拆掉新动画的
    const previous = running;
    running = null;
    previous.animation.cancel();
    previous.cover.remove();
  }
  nav.style.removeProperty("z-index");
  main.style.removeProperty("z-index");
  if (startEdge === toWidth) return;

  const expanding = toWidth > startEdge;
  const left = Math.min(startEdge, toWidth);
  const width = Math.abs(toWidth - startEdge);
  const line = "hsl(var(--border))";
  const cover = document.createElement("div");
  cover.setAttribute("aria-hidden", "true");
  Object.assign(cover.style, {
    position: "fixed",
    top: "0",
    bottom: "0",
    left: `${left}px`,
    width: `${width}px`,
    zIndex: "1",
    pointerEvents: "none",
    background: expanding ? "var(--bg-app)" : "var(--bg-sidebar)",
    boxShadow: expanding ? `-1px 0 0 0 ${line}` : `1px 0 0 0 ${line}`,
  });
  nav.after(cover);
  // 盖板要滑进去的那一侧压在它上面；收起时 main 不抬高，靠它的 isolate
  // 把内容区里带 z-index 的元素（sticky 表头、FullScreenPanel）一起压在盖板下
  (expanding ? main : nav).style.zIndex = "2";

  const animation = cover.animate(
    [
      { transform: "none" },
      { transform: `translateX(${expanding ? width : -width}px)` },
    ],
    { duration: TOGGLE_DURATION_MS, easing: TOGGLE_EASING },
  );
  const edge = () => {
    const transform = getComputedStyle(cover).transform;
    const x =
      transform && transform !== "none"
        ? new DOMMatrixReadOnly(transform).m41
        : 0;
    return (expanding ? left : left + width) + x;
  };
  running = { animation, cover, edge };
  const cleanup = () => {
    if (running?.animation !== animation) return;
    running = null;
    cover.remove();
    nav.style.removeProperty("z-index");
    main.style.removeProperty("z-index");
  };
  animation.onfinish = cleanup;
  animation.oncancel = cleanup;
}

export const sidebarWidth = (
  collapsed: boolean,
  expandedWidth: number = SIDEBAR_EXPANDED_WIDTH,
) => (collapsed ? sidebarRailWidth() : expandedWidth);

function readManualPreference(): boolean | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "true") return true;
    if (saved === "false") return false;
  } catch {
    // 读不到就按窗口宽度自动决定
  }
  return null;
}

function isNarrowWindow(): boolean {
  return (
    typeof window !== "undefined" &&
    window.innerWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH
  );
}

/**
 * 侧栏展开 / 收起：默认跟随窗口宽度（< 960 收起），⌘\ 或按钮手动切换后记住手动的选择。
 * 同时管展开宽度（拖右边缘 / 方向键调整，写 localStorage）。
 * 只在 Sidebar 里用：状态放在 App 的话，每次切换都会把整页重渲染一遍，动画第一帧就掉帧。
 */
export function useSidebarCollapsed(navRef: RefObject<HTMLElement | null>) {
  const [manual, setManual] = useState<boolean | null>(readManualPreference);
  const [narrow, setNarrow] = useState(isNarrowWindow);
  const [expandedWidth, setExpandedWidth] = useState<number>(
    readStoredSidebarWidth,
  );
  const [resizing, setResizing] = useState(false);
  // 拖动时每帧都要拿最新宽度（松手才落盘、开合动画要读目标宽度），等 state 回读会晚一帧，所以再放一份 ref
  const expandedWidthRef = useRef(expandedWidth);

  useEffect(() => {
    const onResize = () => setNarrow(isNarrowWindow());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const collapsed = manual ?? narrow;
  const width = sidebarWidth(collapsed, expandedWidth);
  // 只有手动切换才滑；拖窗口自动收起时直接到位
  const animateFrom = useRef<number | null>(null);

  useLayoutEffect(() => {
    const from = animateFrom.current;
    animateFrom.current = null;
    if (from !== null && navRef.current) {
      animateToggle(
        navRef.current,
        from,
        sidebarWidth(collapsed, expandedWidthRef.current),
      );
    }
    // 拖宽度不走这条：宽度动画只在手动开合时放，拖动要跟手
  }, [collapsed, navRef]);

  const toggle = useCallback(() => {
    const next = !collapsed;
    animateFrom.current = sidebarWidth(collapsed, expandedWidthRef.current);
    setManual(next);
    try {
      localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
      // 记不住也不影响这次切换
    }
  }, [collapsed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const applyWidth = useCallback((next: number) => {
    const clamped = clampSidebarWidth(next);
    expandedWidthRef.current = clamped;
    setExpandedWidth(clamped);
  }, []);

  const commitWidth = useCallback(() => {
    writeStoredSidebarWidth(expandedWidthRef.current);
  }, []);

  const drag = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const onResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (collapsed || event.button !== 0) return;
      // 抓住指针：指针滑出那条几像素宽的把手也还能收到 move / up
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: expandedWidthRef.current,
      };
      setResizing(true);
      // 这里故意不 preventDefault：点一下也要能把焦点给把手，键盘用户才知道能按方向键调
      // （拖拽时不会选中文字，靠 CSS 的 select-none + 下面的 body user-select）
    },
    [collapsed],
  );

  const onResizeMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      // 侧栏在左边，指针往右移就是变宽；本应用没有 RTL 界面语言，不用反号
      applyWidth(current.startWidth + (event.clientX - current.startX));
    },
    [applyWidth],
  );

  const onResizeEnd = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      drag.current = null;
      setResizing(false);
      commitWidth();
    },
    [commitWidth],
  );

  const resetWidth = useCallback(() => {
    applyWidth(SIDEBAR_EXPANDED_WIDTH);
    commitWidth();
  }, [applyWidth, commitWidth]);

  const onResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (collapsed) return;
      let next: number | null = null;
      if (event.key === "ArrowLeft") {
        next = expandedWidthRef.current - RESIZE_KEY_STEP;
      } else if (event.key === "ArrowRight") {
        next = expandedWidthRef.current + RESIZE_KEY_STEP;
      } else if (event.key === "Home") {
        next = SIDEBAR_MIN_WIDTH;
      } else if (event.key === "End") {
        next = SIDEBAR_MAX_WIDTH;
      } else if (event.key === "Enter" || event.key === " ") {
        next = SIDEBAR_EXPANDED_WIDTH;
      }
      if (next === null) return;
      event.preventDefault();
      applyWidth(next);
      commitWidth();
    },
    [applyWidth, collapsed, commitWidth],
  );

  // 收起时把手会被卸载，拖到一半就收起当成松手
  useEffect(() => {
    if (!collapsed) return;
    drag.current = null;
    setResizing(false);
  }, [collapsed]);

  // 拖动时整页保持 col-resize 光标，也别把指针扫过的文字选中
  useEffect(() => {
    if (!resizing) return;
    const body = document.body.style;
    const previousUserSelect = body.userSelect;
    const previousCursor = body.cursor;
    body.userSelect = "none";
    body.cursor = "col-resize";
    return () => {
      body.userSelect = previousUserSelect;
      body.cursor = previousCursor;
    };
  }, [resizing]);

  return {
    collapsed,
    toggle,
    width,
    resizing,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
    onResizeKeyDown,
    resetWidth,
  };
}
