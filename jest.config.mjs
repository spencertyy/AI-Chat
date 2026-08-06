import nextJest from "next/jest.js";

// 指向 app 根目录，让 next/jest 加载 next.config、.env、TS 路径别名
const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const config = {
  // 每个测试文件跑之前，先加载 jest-dom 的断言
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // 用 jsdom 假装有浏览器 DOM（组件测试必需）
  testEnvironment: "jest-environment-jsdom",
  // 两类目录必须排除，否则同一份测试会被跑两遍、模块图还会重名告警：
  // · .next/          —— build 产物，standalone 里有一份 package.json 副本
  // · .claude/worktrees/ —— 后台任务用的 git worktree，是整个仓库的副本，
  //                        里面每个 *.test.ts 都会被当成独立测试再跑一次
  modulePathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/.claude/worktrees/"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/.claude/worktrees/",
  ],
};

export default createJestConfig(config);
