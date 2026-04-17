"use client";
import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  async function handleSend(text?: string) {
    const messageText = (text ?? input).trim();
    if (!messageText) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestamp: new Date(),
    };
    const updatedMessages = [...messages, userMessage];

    setMessages(updatedMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        }),
      });
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }

      const data = await response.json();

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: data.reply,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 2).toString(),
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }
  //   setTimeout(() => {
  //     const aiMessage: Message = {
  //       id: (Date.now() + 1).toString(),
  //       role: "assistant",
  //       content: `You said: ${messageText}`,
  //       timestemp: new Date(),
  //     };
  //     setMessages((prev) => [...prev, aiMessage]);
  //   }, 600);
  // }

  return (
    <div className="chat">
      <header className="header">
        <div className="avatar">🤖</div>
        <div className="service-name">
          <div>AI Chat</div>
          <div className="status"> • Online</div>
        </div>
      </header>

      <main className="main">
        {messages.length === 0 ? (
          <section className="welcome">
            <div className="welcome-icon">💬</div>
            <h1 className="welcome-title">AI chat Assistant </h1>
            <p className="welcome-text">
              What shall we think through?
              <br />
              share what you think!
            </p>
            <div className="suggestions">
              <button
                className="suggestion-btn"
                onClick={() => handleSend("Hello, Introduce yourself")}
              >
                Hello, Introduce yourself
              </button>

              <button
                className="suggestion-btn"
                onClick={() => handleSend("Plan a trip")}
              >
                Plan a trip
              </button>

              <button
                className="suggestion-btn"
                onClick={() => handleSend("Find the best restaurant")}
              >
                Find the best restaurant
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
                        : "message-bubble assistant-bubble"
                    }
                  >
                    <div className="message-content">{msg.content}</div>
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
            {isLoading && (
              <div className="message-row assistant-row">
                <div className="ai-avatar">🤖</div>
                <div className="message-item">
                  <div className="message-bubble assistant-bubble">
                    <div className="loading-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                </div>
              </div>
            )}
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
        <button className="send-btn" onClick={() => handleSend()}>
          ↑
        </button>
      </div>
    </div>
  );
}
