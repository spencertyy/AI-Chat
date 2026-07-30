"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_COLORS } from "../lib/themeColors";

export type Theme = "light" | "dark";

// 主题的「真实来源」是 <html data-theme> 这个 DOM 属性——它由 layout.tsx 里的
// 阻塞式内联脚本在首次绘制前写入。也就是说主题状态活在 React 之外。
//
// 这正是 useSyncExternalStore 的用途：订阅一个 React 管不着的外部状态源。
// 相比"用 useState + useEffect 在挂载后读一次 DOM"的写法，它有三个好处：
//   ① 不需要在 effect 里 setState（那会多触发一轮渲染，也被 lint 规则禁止）
//   ② 提供 getServerSnapshot，服务端渲染时返回确定值，不会 hydration 不匹配
//   ③ 所有调用它的组件天然共享同一份值，不需要 Context 包一层
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

// 客户端快照：直接读 DOM 属性。任何不是 "light" 的值都归为 dark，
// 与 tokens.css 里 :root 默认深色、[data-theme="light"] 覆盖的结构对齐。
function getSnapshot(): Theme {
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

// 服务端快照：SSR 时没有 document。返回 "dark" 与 CSS 的 :root 默认一致，
// 这样服务端产出的 HTML 和客户端首帧对得上。
function getServerSnapshot(): Theme {
  return "dark";
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    // 同步移动端浏览器 UI 的着色。首屏由 layout.tsx 的内联脚本设好，
    // 这里负责手动切换时跟上——否则切了主题地址栏还是旧颜色。
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", THEME_COLORS[next]);
    try {
      localStorage.setItem("theme", next);
    } catch {
      // 隐私模式下 localStorage 可能抛异常；主题照常切换，只是这次选择不持久化
    }
    // 通知所有订阅者重新读快照
    listeners.forEach((l) => l());
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
