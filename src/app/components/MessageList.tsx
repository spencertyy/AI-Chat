import type { Message } from "../types/chat";
import { MarkdownRenderer } from "./MarkDownRenderer";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCopy,
  faThumbsUp,
  faThumbsDown,
} from "@fortawesome/free-regular-svg-icons";
import { faCheck } from "@fortawesome/free-solid-svg-icons";
import { type RefObject } from "react";
import StreamingStats from "./StreamingStats";

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
          {msg.role === "assistant" && <div className="ai-avatar">🤖</div>}
          <div className="message-item">
            <div className="message-meta">
              {msg.role === "assistant" ? (
                <>
                  <span className="message-author">Assistant</span>
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
                  <MarkdownRenderer content={msg.content} />
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
