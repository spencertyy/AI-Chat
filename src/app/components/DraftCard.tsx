"use client";

import { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCopy } from "@fortawesome/free-regular-svg-icons";
import { faCheck } from "@fortawesome/free-solid-svg-icons";

// 军师回复里那句「可发送草稿」的卡片。
//
// 极简：一个贴合文字的小框 + 右上角一个复制图标。不加标签、不加文字按钮、
// 不加阴影——那句草稿本身才是主角，卡片只负责把它框出来、让人一键取走。
// 复制只用图标：复制是通用操作，图标（📋 / ✓）比 "Copy" 文字更省空间也够懂。
//
// 为什么单独成组件、自带复制状态：草稿的复制目标（只有那一句）和「复制整条
// 消息」（含判断+行动的全文）是两码事，共用 MessageList 的单个 copiedId 会
// 互相打架——复制了草稿，整条消息的按钮也会跟着变成对勾。各自管各自的 state
// 才不串味。

type DraftCardProps = {
  /** 已去掉 `Send:` 前缀、去掉首尾空白的草稿正文 */
  draft: string;
};

export default function DraftCard({ draft }: DraftCardProps) {
  // 本地的「刚复制过」状态：点一下变对勾，1.5 秒后复原。
  const [copied, setCopied] = useState(false);

  async function copyDraft() {
    try {
      // 只写草稿本身进剪贴板——用户一键拿到「要发出去的那句」，不用手动圈选。
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      console.error("Failed to copy draft to clipboard.");
    }
  }

  return (
    <div className="draft-card">
      {/* 复古窗口标题栏：珊瑚橙条 "Reply" + 复制键（像窗口控制键）*/}
      <div className="draft-titlebar">
        <span className="draft-title-label">Reply</span>
        <button
          className={`draft-copy-btn ${copied ? "copied" : ""}`}
          onClick={copyDraft}
          aria-label={copied ? "Copied" : "Copy reply"}
          title="Copy reply"
        >
          <FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" />
        </button>
      </div>
      <p className="draft-text">{draft}</p>
    </div>
  );
}
