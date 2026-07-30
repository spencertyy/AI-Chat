/**
 * <meta name="theme-color"> 的取值。
 *
 * 这个 meta 控制移动端浏览器 UI 的着色——iOS Safari 的地址栏/状态栏、
 * Android Chrome 的顶栏。不设置的话，浅色主题下地址栏仍是系统默认色，
 * 和页面之间会出现一条突兀的色带。
 *
 * ⚠️ 必须和 tokens.css 里的 `--color-bg` 保持一致。CSS 变量读不到 meta 里，
 * meta 也读不到 CSS 变量，这是唯一一处需要人工同步的重复值——
 * 所以集中放在这里，让 layout.tsx（首屏内联脚本）和 useTheme.ts（切换时更新）
 * 共用一份，而不是各写各的。
 */
export const THEME_COLORS = {
  light: "#fafafc",
  dark: "#08060f",
} as const;
