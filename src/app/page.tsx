"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// 以后 production 会做：
//debounce = 延迟保存，避免频繁写 localStorage
//throttle = 限制 streaming 时 setMessages 的频率
//save after stream end = 不要每个字符都保存，等 AI 回复结束再保存

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

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-wrap">
      <div className="code-header">
        <span>{language || "text"}</span>
        <button
          className={`copy-btn ${copied ? "copied" : ""}`}
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          title="Copy code"
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
      </div>
      <SyntaxHighlighter style={oneDark} language={language}>
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
    handleSend(newText, messageBeforeEdited, false);
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
    handleSend(lastUserMessage.content, messagesWhithoutLastAssistant);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    setMessages(loadChatHistory());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    saveChatHistory(messages);
  }, [messages, mounted]);

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
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === streamingId ? { ...msg, streaming: false } : msg
              )
            );
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

            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === streamingId
                  ? { ...msg, content: msg.content + char }
                  : msg
              )
            );
          }
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === streamingId ? { ...msg, streaming: false } : msg
          )
        );
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
            {cleared ? "✓" : "🗑️"}
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
                  <div className="message-time">
                    {msg.timestamp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  {msg.role === "user" &&
                    !isLoading &&
                    editingId !== msg.id && (
                      <button
                        className="edit-message-btn"
                        onClick={() => startEditing(msg)}
                      >
                        ✎ Edit
                      </button>
                    )}
                  {msg.role === "assistant" &&
                    !msg.streaming &&
                    msg.id === messages[messages.length - 1].id && (
                      <button
                        className="regenerate-btn"
                        onClick={handleRegenerate}
                      >
                        ↻ Regenerate
                      </button>
                    )}
                </div>

                {msg.role === "user" && <div className="user-avatar">👤</div>}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </main>

      <div className="input-area">
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
    </div>
  );
}
