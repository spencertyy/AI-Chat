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
  // tsconfig 里配了 "@/*" -> "./src/*"，Next 的打包器认得，但 next/jest 并没有
  // 把它转成 jest 的 moduleNameMapper，于是任何 import "@/..." 的模块在测试里
  // 都会报 Cannot find module。这里显式补上同一条映射。
  // $1 是正则捕获组的回填：^@/(.*)$ 匹配到的部分原样接到 <rootDir>/src/ 后面。
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/.next/",
    "<rootDir>/.claude/worktrees/",
  ],
};

export default createJestConfig(config);
