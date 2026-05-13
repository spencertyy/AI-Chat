"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCopy,
  faThumbsUp,
  faThumbsDown,
  faTrashCan,
} from "@fortawesome/free-regular-svg-icons";
import { faCheck } from "@fortawesome/free-solid-svg-icons";

const KEY = "chat-history";

function saveChatHistory(data: any) {
  localStorage.setItem(KEY, JSON.stringify(data));
}

function loadChatHistory(): Message[] {
  try {
    const saved = localStorage.getItem(KEY);
    if (!saved) return [];
    return JSON.parse(saved).map((msg: any) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    }));
  } catch (error) {
    console.error("Failed to load chat history:", error);
    return [];
  }
}

//debounce
//防止过于频繁地保存聊天记录，尤其是在 AI 回复时，每个字符都更新消息并保存会导致性能问题。
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function debounceSaveChatHistory(data: Message[]) {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveChatHistory(data);
  }, 300);
}

function CodeBlock({ language, code }: { language: string; code: string }) {
  const langConfig: Record<
    string,
    { abbr: string; bg: string; color: string }
  > = {
    javascript: { abbr: "JS", bg: "#f7df1e", color: "#000" },
    typescript: { abbr: "TS", bg: "#1a5276", color: "#5dade2" },
    python: { abbr: "PY", bg: "#1a3a4a", color: "#3572A5" },
    html: { abbr: "HTML", bg: "#6e1f0f", color: "#e34c26" },
    css: { abbr: "CSS", bg: "#0f2560", color: "#264de4" },
    json: { abbr: "JSON", bg: "#2d2d2d", color: "#aaaaaa" },
    bash: { abbr: "SH", bg: "#1a3a1a", color: "#55c955" },
  };
  const config = langConfig[language?.toLowerCase()] ?? {
    abbr: language || "TEXT",
    bg: "#2d2d2d",
    color: "#aaaaaa",
  };

  const [copied, setCopied] = useState(false);
  return (
    <div className="code-wrap">
      <div className="code-header">
        <div className="lang-info">
          <span
            className="lang-badge"
            style={{ background: config.bg, color: config.color }}
          >
            {config.abbr}
          </span>
          <span className="lang-name">{language || "text"}</span>
        </div>
        <button
          className={`copy-btn ${copied ? "copied" : ""}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              console.error("Failed to copy code to clipboard.");
            }
          }}
          title="Copy code"
        >
          {copied ? (
            "✓ Copied"
          ) : (
            <>
              <FontAwesomeIcon icon={faCopy} /> Copy
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        customStyle={{ background: `var(--color-code-bg)`, margin: 0 }}
        codeTagProps={{ style: { background: `var(--color-code-bg)` } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ className, children }) {
          const match = /language-(\w+)/.exec(className || "");
          const code = String(children).replace(/\n$/, "");

          if (!match) {
            return <code className="inline-code">{children}</code>;
          }
          return <CodeBlock language={match[1]} code={code} />;
        },
        p({ children }) {
          return <p className="markdown-p">{children}</p>;
        },
        table({ children }) {
          return <table className="markdown-table">{children}</table>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
interface Message {
  id: string;
  role: "user" | "assistant";
  streaming?: boolean;
  content: string;
  timestamp: Date;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]); //loadChatHistory()
  const [isLoading, setIsLoading] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [mounted, setMounted] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null); //用于取消正在进行的请求

  const [editingId, setEditingID] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [reactions, setReactions] = useState<
    Record<
      string,
      { likes: number; dislikes: number; userVote: "likes" | "dislikes" | null }
    >
  >({});

  function handleReaction(msgId: string, type: "likes" | "dislikes") {
    setReactions((prev) => {
      const current = prev[msgId] ?? { likes: 0, dislikes: 0, userVote: null };
      if (current.userVote === type) {
        return {
          ...prev,
          [msgId]: { ...current, [type]: current[type] - 1, userVote: null },
        };
      } else {
        const opposite = type === "likes" ? "dislikes" : "likes";
        return {
          ...prev,
          [msgId]: {
            ...current,
            [type]: current[type] + 1,
            [opposite]:
              current.userVote === opposite
                ? current[opposite] - 1
                : current[opposite],
            userVote: type,
          },
        };
      }
    });
  }

  function startEditing(msg: Message) {
    if (isLoading) return;
    setEditingID(msg.id);
    setEditingText(msg.content);
  }
  function cancelEditMessage() {
    setEditingID(null);
    setEditingText("");
  }
  function saveEditMessage(messageId: string) {
    const newText = editingText.trim();
    if (!newText) return;
    const messageIndex = messages.findIndex((msg) => msg.id === messageId);
    if (messageIndex === -1) return;
    const editedMessage: Message = {
      ...messages[messageIndex],
      content: newText,
      timestamp: new Date(),
    };
    const messageBeforeEdited = messages.slice(0, messageIndex);
    const updatedMessages = [...messageBeforeEdited, editedMessage];
    setEditingID(null);
    setEditingText("");
    setMessages(updatedMessages);
    handleSend(newText, [...messageBeforeEdited, editedMessage], false);
  }
  function handleClear() {
    setMessages([]);
    localStorage.removeItem(KEY);

    setCleared(true);
    setTimeout(() => setCleared(false), 1500);
  }
  function handleStop() {
    abortControllerRef.current?.abort();
    setIsLoading(false);
  }
  function handleRegenerate() {
    if (isLoading) return;
    const lastAssostantIndex = messages
      .map((msg) => msg.role)
      .lastIndexOf("assistant");

    if (lastAssostantIndex === -1) return;

    const messagesWhithoutLastAssistant = messages.slice(0, lastAssostantIndex);
    const lastUserMessage = [...messagesWhithoutLastAssistant]
      .reverse()
      .find((msg) => msg.role === "user");

    if (!lastUserMessage) return;
    setMessages(messagesWhithoutLastAssistant);
    handleSend(lastUserMessage.content, messagesWhithoutLastAssistant, false);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    setMessages(loadChatHistory());
    setMounted(true);
  }, []);

  async function handleSend(
    text?: string,
    baseMessages = messages,
    shouldAddUserMessage = true
  ) {
    if (isLoading) return;
    const messageText = (text ?? input).trim();
    if (!messageText) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };
    const streamingId = crypto.randomUUID();

    const streamingMessage: Message = {
      id: streamingId,
      role: "assistant",
      content: "",
      streaming: true,
      timestamp: new Date(),
    };

    //Throttle
    //在流式过程中，AI 可能会频繁地更新消息内容（每个字符或每几个字符）。如果我们每次更新都调用 setMessages 并保存聊天记录，会导致性能问题。为了解决这个问题，我们可以实现一个节流机制，限制更新消息的频率，例如每 50ms 更新一次。
    let assistantContent = "";
    let lastFlushTime = 0;
    function flushAssistantMessage(force = false) {
      const now = Date.now();
      if (!force && now - lastFlushTime < 40) return; //节流，避免过于频繁地更新消息
      lastFlushTime = now;
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingId ? { ...msg, content: assistantContent } : msg
        )
      );
    }

    const updatedMessages = shouldAddUserMessage
      ? [...baseMessages, userMessage]
      : [...baseMessages];

    setMessages([...updatedMessages, streamingMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const response = await fetch("/api/chat-stream", {
        method: "POST",
        signal: controller.signal, //允许我们在需要时取消请求。
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error("Streaming request failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        //console.log("raw buffer:", buffer);

        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        // console.log("events:", events);

        for (const event of events) {
          if (!event.startsWith("data: ")) continue;

          const data = event.replace("data: ", "").trim();

          if (data === "[DONE]") {
            flushAssistantMessage(true); //强制刷新剩余内容
            const finalMessages: Message[] = [
              ...updatedMessages,
              {
                ...streamingMessage,
                content: assistantContent,
                streaming: false,
              },
            ];
            setMessages(finalMessages);
            //save after stream end
            debounceSaveChatHistory(finalMessages);
            return;
          }
          const parsed = JSON.parse(data);

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          const delta = parsed.text ?? "";
          //console.log("delta:", delta);

          for (let i = 0; i < delta.length; i++) {
            await new Promise((res) => setTimeout(res, 20));
            const char = delta[i];

            assistantContent += char;
            flushAssistantMessage();
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        const stopedMessages: Message[] = [
          ...updatedMessages,
          {
            ...streamingMessage,
            content:
              assistantContent + "\n\n*--- Response stopped by user ---*",
            streaming: false,
          },
        ];
        setMessages(stopedMessages);
        debounceSaveChatHistory(stopedMessages);
        return;
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingId
            ? {
                ...msg,
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Sorry, something went wrong. Please try again.",
                streaming: false,
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="chat">
      <header className="header">
        <div className="avatar">🤖</div>
        <div className="service-name">
          <div>AI Chat</div>
          <div className="status">
            <span className={`status-dot ${isLoading ? "typing" : ""}`} />
            {isLoading ? "Typing..." : "Online"}
          </div>
        </div>
        {messages.length > 0 && (
          <button
            className={`clear-btn ${cleared ? "cleared" : ""}`}
            onClick={handleClear}
            disabled={isLoading}
            title="Clear conversation"
          >
            {cleared ? "✓" : <FontAwesomeIcon icon={faTrashCan} />}
          </button>
        )}
      </header>

      <main className="main">
        {messages.length === 0 ? (
          <section className="welcome">
            <div className="welcome-icon">💬</div>
            <h1 className="welcome-title">Hi, I'm your AI Assistant</h1>
            <p className="welcome-text">Ask me anything — I'm here to help.</p>
            <div className="suggestions">
              <button
                className="suggestion-btn"
                onClick={() => handleSend("Help me write an email")}
              >
                📝 Help me write an email
              </button>

              <button
                className="suggestion-btn"
                onClick={() => handleSend("Recommend a travel destination")}
              >
                🌍 Recommend a travel destination
              </button>

              <button
                className="suggestion-btn"
                onClick={() => handleSend("Give me a startup idea")}
              >
                💡 Give me a startup idea
              </button>
            </div>
          </section>
        ) : (
          <div className="messages">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={
                  msg.role === "user"
                    ? "message-row user-row"
                    : "message-row assistant-row"
                }
              >
                {msg.role === "assistant" && (
                  <div className="ai-avatar">🤖</div>
                )}
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

                  {msg.role === "user" &&
                    !isLoading &&
                    editingId !== msg.id && (
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
                              console.error(
                                "Failed to copy text to clipboard."
                              );
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
                              console.error(
                                "Failed to copy text to clipboard."
                              );
                            }
                          }}
                        >
                          {copiedId === msg.id ? (
                            <FontAwesomeIcon icon={faCheck} />
                          ) : (
                            <FontAwesomeIcon icon={faCopy} />
                          )}
                        </button>
                        <button
                          className="action-btn"
                          onClick={handleRegenerate}
                        >
                          ↻ Regenerate
                        </button>
                        <button
                          className={
                            "action-btn reaction-btn ${reactions[msg.id]?.userVote === 'likes' ? 'liked' : ''}"
                          }
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
                          className={
                            "action-btn reaction-btn ${reactions[msg.id]?.userVote === 'likes' ? 'liked' : ''}"
                          }
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
                </div>

                {msg.role === "user" && <div></div>}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <div className="input-area">
        <div className="input-wrapper">
          <div className="input-box">
            <input
              className="input"
              type="text"
              placeholder="How can I help you today?"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return; //解决输入法问题

                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            {isLoading ? (
              <button className="send-btn stop-btn" onClick={handleStop}>
                ■
              </button>
            ) : (
              <button className="send-btn" onClick={() => handleSend()}>
                ↑
              </button>
            )}
          </div>
          <p className="ai-disclaimer">
            AI may make mistakes, Please verify important information.
          </p>
        </div>
      </div>
    </div>
  );
}
