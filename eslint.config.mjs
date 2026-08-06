// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 后台任务用的 git worktree 是整个仓库的副本，不排除的话
    // 每个问题都会被报两遍（错误数直接翻倍，看起来像是回归）
    ".claude/worktrees/**",
    // 覆盖率报告是产物，其中的 HTML/JS 带 eslint-disable 注释会误报
    "coverage/**",
  ]),
  ...storybook.configs["flat/recommended"]
]);

export default eslintConfig;
