"use client";
import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  streaming?: boolean;
  content: string;
  timestamp: Date;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [cleared, setCleared] = useState(false);

  function handleClear() {
    setMessages([]);
    setCleared(true);
    setTimeout(() => setCleared(false), 1500);
  }
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function handleSend(text?: string) {
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

    const updatedMessages = [...messages, userMessage];

    setMessages([...updatedMessages, streamingMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat-stream", {
        method: "POST",
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
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === streamingId
            ? {
                ...msg,
                id: crypto.randomUUID(),
                role: "assistant",
                content: "Sorry, something went wrong. Please try again.",
              }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
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
              {/* <button className="suggestion-btn">What time</button> */}
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
                        ? "message-bubble user-bubble"
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
            if (e.key === "Enter") {
              handleSend();
            }
          }}
        />
        <button
          className="send-btn"
          onClick={() => handleSend()}
          disabled={isLoading}
        >
          ↑
        </button>
      </div>
    </div>
  );
}
