"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Persona } from "../types/chat";
import Avatar from "./Avatar";

type PersonaSelectorProps = {
  selectPersona: Persona;
  personas: Persona[];
  setSelectPersona: (persona: Persona) => void;
  className?: string;
};

export default function PersonaSelector({
  selectPersona,
  personas,
  setSelectPersona,
  className = "",
}: PersonaSelectorProps) {
  const [open, setOpen] = useState(false);

  // 同时包住触发器和菜单——这样点在触发器上不会被"点击外部"逻辑判为外部，
  // 否则点第二下关闭时会先被 document 监听关掉、再被按钮自身 toggle 打开，永远关不掉。
  // （这段与 AuthButton 是同一套模式，ModelSelector 反而没做，是它的短板。）
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // 军师人格和通用问答分两组显示，中间一条分隔线。
  // 它们是**不同种类的东西**——一个给回复草稿，一个正常答题——混在一个平列表里
  // 会让人以为 Straight Up 只是"第四种语气"。
  const advisors = personas.filter((p) => p.kind === "advisor");
  const assistants = personas.filter((p) => p.kind === "assistant");

  function renderOption(persona: Persona) {
    const active = persona.id === selectPersona.id;
    return (
      <button
        key={persona.id}
        className="persona-option"
        // aria-pressed 而不是 aria-selected：这是一组互斥的切换按钮，
        // 不是 listbox 的选项。读屏会播报"已按下/未按下"，语义对得上。
        aria-pressed={active}
        // 显式给名字，而不是让浏览器把后代文本拼起来：默认拼接会读成
        // "Savage Cuts through your excuses, then makes you stop ✓"——
        // 名字和描述之间没有停顿，末尾还多一个对勾。破折号带来自然停顿，
        // 选中状态则交给 aria-pressed，不重复播报。
        aria-label={`${persona.name} — ${persona.tagline}`}
        onClick={() => {
          setSelectPersona(persona);
          setOpen(false);
        }}
      >
        {/* aria-hidden：头像是纯装饰，紧邻的文字已经写着人格名。
            不加的话读屏会念出图片 alt / "火焰"这种冗余内容。
            有 avatar 图就显示图，没有则回退 emoji（Avatar 组件负责兜底）。*/}
        <span className="persona-option-emoji" aria-hidden="true">
          <Avatar
            src={persona.avatar}
            emoji={persona.emoji}
            name={persona.name}
          />
        </span>
        <span className="persona-option-text">
          <span className="persona-option-name">{persona.name}</span>
          <span className="persona-option-tagline">{persona.tagline}</span>
        </span>
        {/* 对勾是给眼睛看的，选中状态已由 aria-pressed 表达。
            不加 aria-hidden 的话读屏会在末尾多念一句"对勾"——
            同一个状态播报两遍，是纯噪音。*/}
        {active && (
          <span className="persona-check" aria-hidden="true">
            ✓
          </span>
        )}
      </button>
    );
  }

  return (
    <div className={`persona-selector ${className}`} ref={rootRef}>
      <button
        className="persona-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="persona-trigger-emoji" aria-hidden="true">
          <Avatar
            src={selectPersona.avatar}
            emoji={selectPersona.emoji}
            name={selectPersona.name}
          />
        </span>
        {selectPersona.name}
        <ChevronDown size={16} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="persona-menu">
          {advisors.map(renderOption)}
          {assistants.length > 0 && (
            <>
              <div className="persona-menu-divider" role="separator" />
              {assistants.map(renderOption)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
