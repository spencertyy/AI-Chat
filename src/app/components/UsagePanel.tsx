"use client";
import { useState } from "react";
import { ChartColumn, ChevronDown } from "lucide-react";
import { loadConversations } from "../lib/localStorageChat";
import {
  summarizeUsage,
  formatTokens,
  formatCost,
  type UsageSummary,
} from "../lib/usage";

// 请求的四个状态用可辨识联合（discriminated union）表达，而不是
// { loading: boolean; error: string|null; data: X|null } 这种三个独立字段——
// 后者能表示出 "loading 且 error 且有 data" 这种不可能的组合，
// 前者从类型层面就排除了，且 TS 会在每个分支里自动收窄出可用字段。
type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; data: UsageSummary };

export default function UsagePanel({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });

  // 渐进式披露（progressive disclosure）：不点开就不请求。
  // 每次展开都重新取，而不是缓存首次结果——用量会随着聊天一直变，
  // 显示一个几分钟前的旧数字比多发一次廉价查询更糟。
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    if (!isAuthenticated) {
      // 游客：数据全在 localStorage，同步读完直接算，没有网络往返也就没有 loading 态
      try {
        const rows = loadConversations().flatMap((conv) => conv.messages);
        setState({ status: "success", data: summarizeUsage(rows) });
      } catch {
        setState({ status: "error", message: "Could not read local usage." });
      }
      return;
    }

    setState({ status: "loading" });
    try {
      const res = await fetch("/api/usage");
      if (!res.ok) throw new Error();
      setState({ status: "success", data: await res.json() });
    } catch {
      // 这里不透传服务端异常文案，避免把内部细节暴露给用户
      setState({ status: "error", message: "Could not load usage." });
    }
  }

  return (
    <div className="usage-panel">
      <button
        type="button"
        className="menu-item"
        onClick={toggle}
        aria-expanded={open}
      >
        <ChartColumn size={15} />
        <span>Usage</span>
        <ChevronDown
          size={14}
          className={`usage-chevron ${open ? "is-open" : ""}`}
        />
      </button>

      {open && (
        <div className="usage-body">
          {state.status === "loading" && (
            <div className="usage-hint">Loading…</div>
          )}
          {state.status === "error" && (
            <div className="usage-hint usage-error">{state.message}</div>
          )}
          {state.status === "success" && (
            <>
              <div className="usage-row">
                <span className="usage-label">Tokens</span>
                <span className="usage-value">
                  {formatTokens(state.data.inputTokens)} in ·{" "}
                  {formatTokens(state.data.outputTokens)} out
                </span>
              </div>
              <div className="usage-row">
                <span className="usage-label">Spend</span>
                <span className="usage-value">
                  ≈ {formatCost(state.data.cost)}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
