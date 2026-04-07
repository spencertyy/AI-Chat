"use client";
import { useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestemp: Date;
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  function handleSend(text?: string) {
    const messageText = (text ?? input).trim();

    if (!messageText) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: messageText,
      timestemp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    setTimeout(() => {
      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `You said: ${messageText}`,
        timestemp: new Date(),
      };
      setMessages((prev) => [...prev, aiMessage]);
    }, 600);
  }

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
                    {msg.timestemp.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>

                {msg.role === "user" && <div className="user-avatar">👤</div>}
              </div>
            ))}
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
