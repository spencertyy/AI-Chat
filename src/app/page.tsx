"use client";
import InputArea from "./components/InputArea";
import PersonaSelector from "./components/PersonaSelector";
import Sidebar from "./components/Sidebar";
import MessageList from "./components/MessageList";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTrashCan } from "@fortawesome/free-regular-svg-icons";
import useChat from "./hooks/useChat";
import { useState } from "react";

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
    personas,
    selectPersona,
    setSelectPersona,
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
          {/* 人格占据 header 上原属模型选择器的位置——这是"人格是一等公民、
              模型是实现细节"这条定位在界面上的落点。模型选择器移到输入框
              底部工具排（InputArea），能力没删，只是不再抢第一注意力。
              AdvancedSettings 抽屉暂不挂载，阶段 4 装入其他设置时再回来。*/}
          <PersonaSelector
            selectPersona={selectPersona}
            personas={personas}
            setSelectPersona={setSelectPersona}
            className="header-persona"
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
              {/* 撇号用 &rsquo;（右单引号）而非 &apos;：’ 才是英文正文里正确的
                  省略撇号，顺带满足 react/no-unescaped-entities。 */}
              <p className="welcome-text">
                Tell me what happened — I&rsquo;ll help you find the words.
              </p>
              <div className="suggestions">
                <button
                  className="suggestion-btn"
                  onClick={() => handleSend("They stopped replying to me")}
                >
                  🔥 They stopped replying
                </button>

                <button
                  className="suggestion-btn"
                  onClick={() => handleSend("How do I bring up what's bothering me")}
                >
                  🕯 How do I bring it up
                </button>

                <button
                  className="suggestion-btn"
                  onClick={() => handleSend("She went cold on me out of nowhere")}
                >
                  🎩 She went cold on me
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
          selectModel={selectModel}
          models={models}
          setSelectModel={setSelectModel}
        />
      </div>
    </div>
  );
}
