import type { Message } from "../types/chat";
import { MarkdownRenderer } from "./MarkDownRenderer";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCopy,
  faThumbsUp,
  faThumbsDown,
} from "@fortawesome/free-regular-svg-icons";
import { faCheck, faCircleInfo } from "@fortawesome/free-solid-svg-icons";
import { type RefObject } from "react";
import StreamingStats from "./StreamingStats";
import DraftCard from "./DraftCard";
import Avatar from "./Avatar";
import { splitDraft } from "../lib/personaGuard";
import { getPersona } from "../lib/personas";

// 渲染一条 assistant 回复的正文。
//
// 军师人格（advisor）的回复要拆成「判断文本 + 草稿卡片 + 行动文本」三块：
// 前后两块走 markdown，中间那句 Send: 草稿渲染成 DraftCard（一键复制）。
// 其余情况（通用问答、或军师回复里没解析出 Send: 行）照旧整段 markdown 渲染。
//
// ⚠️ 只有**回放结束后**（!streaming）才拆卡片：流式回放时 content 逐字增长，
// Send: 行可能只到一半，此刻拆出的草稿是残缺的、卡片会边长边抖。回放很快
// （约 0.4 秒），等它结束再一次性从纯文本切成卡片，观感最稳。
function AssistantContent({ msg }: { msg: Message }) {
  const persona = getPersona(msg.persona);
  const sections =
    persona?.kind === "advisor" && !msg.streaming
      ? splitDraft(msg.content)
      : null;

  if (!sections) {
    return <MarkdownRenderer content={msg.content} />;
  }

  return (
    <>
      {sections.before && <MarkdownRenderer content={sections.before} />}
      <DraftCard draft={sections.draft} />
      {sections.after && <MarkdownRenderer content={sections.after} />}
    </>
  );
}

// 两种限流对用户意味着不同的事，文案必须分开：IP 超限是"你发快了"，
// 一小时后恢复；全局超限是"全站今天用完了"。共用一句话的话，第一次
// 访问就撞上全局限额的人会看到"你请求太频繁"，只会把它当成 bug。
const DEGRADED_NOTICE: Record<NonNullable<Message["degraded"]>, string> = {
  ip: "Demo mode — you've used this hour's quota. It resets shortly.",
  global: "Demo mode — today's public quota is used up. It resets tomorrow.",
};

type MessageListProps = {
  messages: Message[];
  saveEditMessage: (messageId: string) => void;
  editingId: string | null;
  cancelEditMessage: () => void;
  isLoading: boolean;
  editingText: string;
  setEditingText: (value: string) => void;
  copiedId: string | null;
  setCopiedId: (value: string | null) => void;
  handleRegenerate: () => void;
  bottomRef: RefObject<HTMLDivElement | null>;
  startEditing: (msg: Message) => void;
  handleReaction: (msgId: string, type: "likes" | "dislikes") => void;
  reactions: Record<
    string,
    { likes: number; dislikes: number; userVote: "likes" | "dislikes" | null }
  >;
};

export default function MessageList({
  messages,
  saveEditMessage,
  editingId,
  editingText,
  setEditingText,
  cancelEditMessage,
  isLoading,
  copiedId,
  setCopiedId,
  handleRegenerate,
  bottomRef,
  startEditing,
  handleReaction,
  reactions,
}: MessageListProps) {
  return (
    <div className="messages">
      {messages.map((msg, index) => (
        <div
          key={msg.id}
          className={
            msg.role === "user"
              ? "message-row user-row"
              : "message-row assistant-row"
          }
        >
          {msg.role === "assistant" && (
            // 头像绑定生成这条回复的人格：有配 avatar 图就显示图，否则用人格
            // emoji（🔥/🕯/🎩/💬），让不同人格在对话流里一眼可辨。旧消息没存
            // persona、或 id 认不出时回退到 🤖。
            <div className="ai-avatar">
              <Avatar
                src={getPersona(msg.persona)?.avatar}
                emoji={getPersona(msg.persona)?.emoji ?? "🤖"}
                name={getPersona(msg.persona)?.name ?? "Assistant"}
              />
            </div>
          )}
          <div className="message-item">
            <div className="message-meta">
              {msg.role === "assistant" ? (
                <>
                  <span className="message-author">
                    {getPersona(msg.persona)?.name ?? "Assistant"}
                  </span>
                  <span className="message-dot">.</span>
                </>
              ) : null}
              <span className="message-time">
                {msg.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <div
              className={
                msg.role === "user"
                  ? editingId === msg.id
                    ? "message-bubble editing-bubble"
                    : "message-bubble user-bubble"
                  : msg.streaming && msg.content === ""
                  ? "message-bubble assistant-bubble loading-bubble"
                  : "message-bubble assistant-bubble"
              }
            >
              {/* 降级提示放在气泡内、正文之上——它是这条回复的一部分，
                  不是一个飘在旁边的全局横幅。role="status" 让读屏在它
                  出现时播报，但不打断用户当前的操作（不同于 alert）。*/}
              {msg.degraded && (
                <div className="degraded-notice" role="status">
                  <FontAwesomeIcon icon={faCircleInfo} aria-hidden="true" />
                  <span>{DEGRADED_NOTICE[msg.degraded]}</span>
                </div>
              )}
              <div className="message-content">
                {msg.streaming && msg.content === "" ? (
                  <div className="loading-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : msg.role === "user" && editingId === msg.id ? (
                  <div className="edit-box">
                    <textarea
                      className="edit-textarea"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;

                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          saveEditMessage(msg.id);
                        }

                        if (e.key === "Escape") {
                          cancelEditMessage();
                        }
                      }}
                    />

                    <div className="edit-actions">
                      <button onClick={cancelEditMessage}>Cancel</button>
                      <button onClick={() => saveEditMessage(msg.id)}>
                        Save
                      </button>
                    </div>
                  </div>
                ) : msg.role === "assistant" ? (
                  <AssistantContent msg={msg} />
                ) : (
                  msg.content
                )}
              </div>
            </div>

            {msg.role === "user" && !isLoading && editingId !== msg.id && (
              <div className="message-actions">
                <button
                  className="action-btn"
                  onClick={() => startEditing(msg)}
                >
                  ✎ Edit
                </button>
                <button
                  className="action-btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(msg.content);
                      setCopiedId(msg.id);
                      setTimeout(() => setCopiedId(null), 1500);
                    } catch {
                      console.error("Failed to copy text to clipboard.");
                    }
                  }}
                >
                  {copiedId === msg.id ? (
                    <FontAwesomeIcon icon={faCheck} />
                  ) : (
                    <FontAwesomeIcon icon={faCopy} />
                  )}
                </button>
              </div>
            )}
            {msg.role === "assistant" &&
              !msg.streaming &&
              msg.id === messages[messages.length - 1].id && (
                <div className="message-actions">
                  <button
                    className="action-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(msg.content);
                        setCopiedId(msg.id);
                        setTimeout(() => setCopiedId(null), 1500);
                      } catch {
                        console.error("Failed to copy text to clipboard.");
                      }
                    }}
                  >
                    {copiedId === msg.id ? (
                      <FontAwesomeIcon icon={faCheck} />
                    ) : (
                      <FontAwesomeIcon icon={faCopy} />
                    )}
                  </button>
                  <button className="action-btn" onClick={handleRegenerate}>
                    ↻ Regenerate
                  </button>
                  <button
                    className={`action-btn reaction-btn ${
                      reactions[msg.id]?.userVote === "likes" ? "liked" : ""
                    }`}
                    onClick={() => handleReaction(msg.id, "likes")}
                  >
                    <FontAwesomeIcon icon={faThumbsUp} />
                    {reactions[msg.id]?.likes ? (
                      <span className="reaction-count">
                        +{reactions[msg.id].likes}
                      </span>
                    ) : null}
                  </button>
                  <button
                    className={`action-btn reaction-btn ${
                      reactions[msg.id]?.userVote === "likes" ? "liked" : ""
                    }`}
                    onClick={() => handleReaction(msg.id, "dislikes")}
                  >
                    <FontAwesomeIcon icon={faThumbsDown} />
                    {reactions[msg.id]?.dislikes ? (
                      <span className="reaction-count">
                        +{reactions[msg.id].dislikes}
                      </span>
                    ) : null}
                  </button>
                </div>
              )}
            {/* 用量统计只跟着"最新的那条回复"走，历史消息不再常驻显示 token
                （数据仍然入库，汇总统一进头像菜单的 Usage 面板）。
                key 绑消息 id：换一条消息就重新挂载，状态机从头开始。 */}
            {msg.role === "assistant" && index === messages.length - 1 && (
              <StreamingStats
                key={msg.id}
                streaming={!!msg.streaming}
                content={msg.content}
                inputTokens={msg.inputTokens}
                outputTokens={msg.outputTokens}
              />
            )}
          </div>

          {msg.role === "user" && <div></div>}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
