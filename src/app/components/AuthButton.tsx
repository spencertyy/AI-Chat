"use client";
import { useEffect, useRef, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import { ArrowUpCircle, LogOut } from "lucide-react";
import UsagePanel from "./UsagePanel";

export default function AuthButton() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  // 同时包住触发器和菜单——这样点在触发器上不会被"点击外部"逻辑判为外部，
  // 否则点第二下关闭时会先被 document 监听关掉、再被按钮自身 toggle 打开，永远关不掉。
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / 按 Esc 关闭菜单。
  // 只在 open 为 true 时才挂监听：菜单关着时没必要让每一次全局点击都跑一遍回调。
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // 用 mousedown 而不是 click：按下的瞬间就关，手感更跟手；
    // 也避开了"点击目标在 click 触发前已被移除导致 contains 判断失效"的坑。
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (status === "loading") return <span className="auth-loading">…</span>;

  // 游客：登录按钮是这里的首要行动，不能藏进下拉菜单里，
  // 所以用量入口平铺在它上面，读的是 localStorage 的本地数据。
  if (!session) {
    return (
      <div className="auth-guest">
        <UsagePanel isAuthenticated={false} />
        <button className="auth-signin-btn" onClick={() => signIn("google")}>
          <img
            src="https://www.google.com/favicon.ico"
            alt="Google"
            width={16}
            height={16}
          />
          Use Google to Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="auth-root" ref={rootRef}>
      <button
        type="button"
        className="auth-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <img
          className="auth-avatar"
          src={session.user?.image ?? undefined}
          alt=""
        />
        <span className="auth-name">{session.user?.name}</span>
      </button>

      {open && (
        <div className="auth-menu" role="menu">
          <UsagePanel isAuthenticated />
          {/* 纯展示的假按钮：demo 里用来交代"这是个有计费概念的产品"，
              点了只提示，不做任何事——不接支付比接一个假的支付流程诚实。 */}
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => alert("Upgrade is not available in this demo.")}
          >
            <ArrowUpCircle size={15} />
            <span>Upgrade plan</span>
          </button>
          <button
            type="button"
            className="menu-item"
            role="menuitem"
            onClick={() => signOut()}
          >
            <LogOut size={15} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
