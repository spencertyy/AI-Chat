import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";

// jsdom 没有实现 TextEncoder / TextDecoder（它们属于 Encoding API，
// jsdom 只覆盖 DOM，不覆盖这类 Web 平台 API）。
// useChat 解析 SSE 流时要用 TextDecoder 把 Uint8Array 转回字符串，
// 缺了它测试会报 "TextDecoder is not defined"。
// Node 自带的实现与浏览器行为一致，直接借用即可。
//
// 放在 setupFilesAfterEach 里而不是单个测试文件里：这是环境能力补齐，
// 之后任何涉及流式/编码的测试都需要，不该让每个文件各自 polyfill 一遍。
Object.assign(globalThis, { TextDecoder, TextEncoder });
