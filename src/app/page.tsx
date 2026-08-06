"use client";
import InputArea from "./components/InputArea";
import ModelSelector from "./components/ModelSelector";
import Sidebar from "./components/Sidebar";
import MessageList from "./components/MessageList";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashCan } from "@fortawesome/free-regular-svg-icons";
import useChat from "./hooks/useChat";
import { useState } from "react";
import { Divide } from "lucide-react";

export default function Home() {
  const {
    input,
    setInput,
    messages,
    conversations,
    activeConvId,
    setActiveConvId,
    isLoading,
    cleared,
    editingId,
    editingText,
    setEditingText,
    copiedId,
    setCopiedId,
    reactions,
    bottomRef,
    handleSend,
    handleReaction,
    handleNewChat,
    handleDeleteConv,
    handleClear,
    handleStop,
    handleRegenerate,
    startEditing,
    cancelEditMessage,
    saveEditMessage,
    selectModel,
    models,
    setSelectModel,
    handleRenameConv,
  } = useChat();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  function toggleSidebar() {
    setIsSidebarOpen((prev) => !prev);
  }
  return (
    <div className="app-layout">
      <Sidebar
        conversations={conversations}
        activeConvId={activeConvId}
        setActiveConvId={setActiveConvId}
        handleNewChat={handleNewChat}
        handleDeleteConv={handleDeleteConv}
        isSidebarOpen={isSidebarOpen}
        onToggle={toggleSidebar}
        handleRenameConv={handleRenameConv}
      />
      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={toggleSidebar} />
      )}
      <div className="chat">
        <header className="header">
          <button className="mobile-menu-btn" onClick={toggleSidebar}>
            ☰
          </button>
          <ModelSelector
            selectModel={selectModel}
            models={models}
            setSelectModel={setSelectModel}
            className="header-model"
          />
          <div className="header-right">
            <span className={`status-pill ${isLoading ? "typing" : ""}`}>
              <span className={`status-dot ${isLoading ? "typing" : ""}`} />
              {isLoading ? "Typing..." : "Online"}
            </span>
            <button
              className={`clear-btn ${cleared ? "cleared" : ""}`}
              onClick={handleClear}
              disabled={isLoading || messages.length === 0}
              title="Clear conversation"
            >
              {cleared ? "✓" : <FontAwesomeIcon icon={faTrashCan} />}
            </button>
          </div>
        </header>
        <main className="main">
          {messages.length === 0 ? (
            <section className="welcome">
              <div className="welcome-icon">💬</div>
              {/* 撇号用 &rsquo;（右单引号）而不是 &apos;：排版上 ' 是直角撇号，
                  ’ 才是英文正文里正确的省略撇号。顺带满足 react/no-unescaped-entities
                  ——该规则的用意是避免裸 ' 被误读成 JSX 属性引号的开头。 */}
              <h1 className="welcome-title">Hi, I&rsquo;m your AI Assistant</h1>
              <p className="welcome-text">
                Ask me anything — I&rsquo;m here to help.
              </p>
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
            <MessageList
              messages={messages}
              saveEditMessage={saveEditMessage}
              editingId={editingId}
              editingText={editingText}
              setEditingText={setEditingText}
              cancelEditMessage={cancelEditMessage}
              isLoading={isLoading}
              copiedId={copiedId}
              setCopiedId={setCopiedId}
              handleRegenerate={handleRegenerate}
              bottomRef={bottomRef}
              startEditing={startEditing}
              handleReaction={handleReaction}
              reactions={reactions}
            />
          )}
        </main>
        <InputArea
          input={input}
          setInput={setInput}
          handleSend={handleSend}
          isLoading={isLoading}
          handleStop={handleStop}
        />
      </div>
    </div>
  );
}
