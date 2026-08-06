"use client";
import { useEffect, useState } from "react";
import { estimateTokens } from "../lib/usage";

// 三阶段状态机：
//   streaming — 正在流式，秒数实时跳动，token 是按字符估算的 "~" 值
//   linger    — 流已结束，换成服务端回来的真实 token，停留 3 秒
//   hidden    — 彻底不渲染
// 之所以要 linger 这一档：真实 token 只有在流结束时才随 usage 事件到达，
// 如果一结束就消失，用户看到的永远只是估算值，真实值一闪而过等于没显示。
//
// 三个阶段里只有 hidden 需要存成 state（它由定时器决定）；
// streaming / linger 直接由 streaming 这个 prop 派生（derived state），
// 不额外存一份——同一个事实存两处迟早会不同步。
type Phase = "streaming" | "linger" | "hidden";

const LINGER_MS = 3000;
// 每 250ms 采样一次而不是 1000ms：流结束时最后一次读数的误差被压到 0.25 秒内。
// 采样变密不会变贵——Math.round 到秒后值大多不变，setState 传入相同值时
// React 会直接跳过重渲染（Object.is 比较），所以实际仍是每秒才渲染一次。
const TICK_MS = 250;

export default function StreamingStats({
  streaming,
  content,
  inputTokens,
  outputTokens,
}: {
  streaming: boolean;
  content: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  // useState 的惰性初始化（lazy initializer）：传函数而不是传值，
  // 函数只在挂载时执行一次。写成 useState(Date.now()) 的话，
  // Date.now() 每次渲染都会求值（虽然结果被丢弃），既浪费也容易误读。
  const [startedAt] = useState(() => Date.now());
  // 挂载那一刻是否正在流式。打开一段历史对话时，最后一条是早已完成的回复，
  // 这个组件会以 streaming=false 挂载——那种情况下自始至终什么都不该显示。
  const [wasStreamingAtMount] = useState(streaming);
  const [elapsed, setElapsed] = useState(0);
  const [hidden, setHidden] = useState(false);

  // 计时器。setState 只出现在 interval 的回调里，而不是 effect 函数体内——
  // 在体内同步 setState 会立刻触发第二轮渲染（级联渲染），
  // ESLint 的 react-hooks/set-state-in-effect 拦的就是这个。
  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => {
      setElapsed(Math.round((Date.now() - startedAt) / 1000));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [streaming, startedAt]);

  // 流结束 → 3 秒后隐藏。
  // cleanup 里的 clearTimeout 不可省：组件在这 3 秒内被卸载时
  // （用户发了新消息，统计行跟着换到新回复上），
  // 残留的定时器会在已卸载的组件上 setState。
  useEffect(() => {
    if (streaming) return;
    const timer = setTimeout(() => setHidden(true), LINGER_MS);
    return () => clearTimeout(timer);
  }, [streaming]);

  const phase: Phase = hidden ? "hidden" : streaming ? "streaming" : "linger";

  // 提前 return 必须写在所有 Hook 之后——Hook 的调用顺序在每次渲染间必须一致，
  // 放在 useState 之前会让这个组件在两种分支里调用不同数量的 Hook。
  if (!wasStreamingAtMount || phase === "hidden") return null;

  // 真实值只在流结束后才有；缺失时（例如用户中途点了 Stop）继续沿用估算值
  const hasReal = outputTokens != null;
  const showReal = phase === "linger" && hasReal;
  const tokens = showReal ? outputTokens : estimateTokens(content);

  return (
    <div className="streaming-stats">
      {elapsed}s · {showReal ? "" : "~"}
      {tokens} tokens
      {showReal && inputTokens != null && (
        <span className="streaming-stats-in"> ({inputTokens} in)</span>
      )}
    </div>
  );
}
