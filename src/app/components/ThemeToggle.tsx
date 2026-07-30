"use client";

import { useTheme } from "../hooks/useTheme";

// 星星和云朵的位置用百分比而非 px —— 这样整个开关换尺寸时装饰会跟着等比缩放，
// 不需要为每个尺寸重新调一遍坐标。
const STARS = [
  { top: "22%", left: "20%", size: 3 },
  { top: "52%", left: "14%", size: 2 },
  { top: "32%", left: "36%", size: 2 },
  { top: "68%", left: "42%", size: 2 },
];

const CLOUDS = [
  { top: "52%", left: "50%", w: "16%", h: "12%" },
  { top: "64%", left: "68%", w: "22%", h: "10%" },
  { top: "38%", left: "74%", w: "14%", h: "10%" },
];

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      data-on={theme}
      onClick={toggleTheme}
      // aria-pressed 让屏幕阅读器知道这是个「开关」而不是普通按钮，
      // 并且能读出当前是按下(dark)还是弹起(light)状态。
      aria-pressed={isDark}
      aria-label={isDark ? "切换到浅色主题" : "切换到深色主题"}
      title={isDark ? "切换到浅色主题" : "切换到深色主题"}
    >
      {/* aria-hidden：纯装饰，不该被屏幕阅读器读出来 */}
      <span className="tt-clouds" aria-hidden="true">
        {CLOUDS.map((c, i) => (
          <i key={i} style={{ top: c.top, left: c.left, width: c.w, height: c.h }} />
        ))}
      </span>
      <span className="tt-stars" aria-hidden="true">
        {STARS.map((s, i) => (
          <i
            key={i}
            style={{ top: s.top, left: s.left, width: s.size, height: s.size }}
          />
        ))}
      </span>
      <span className="tt-knob" aria-hidden="true" />
    </button>
  );
}
