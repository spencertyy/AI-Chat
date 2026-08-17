"use client";

import { useEffect, useRef, useState } from "react";
import { Settings2 } from "lucide-react";
import ModelSelector from "./ModelSelector";
import type { Model } from "../types/chat";

type AdvancedSettingsProps = {
  selectModel: Model;
  models: Model[];
  setSelectModel: (model: Model) => void;
};

/**
 * 高级设置抽屉 —— 目前只装模型选择器。
 *
 * 存在的理由是产品定位而不是功能：**人格是一等公民，模型是实现细节**。
 * 用户想要的是"一个毒舌的建议"，不是"gemini-3.1-flash-lite"。所以 header
 * 上那个显眼位置让给了 PersonaSelector，模型选择降一层，想调的人仍然调得到。
 *
 * 多模型能力**没有删**——它仍是这个项目的技术卖点，只是不再占据用户的第一
 * 注意力。阶段 4 还会往这里加东西（每个人格绑定的模型、成本上限）。
 */
export default function AdvancedSettings({
  selectModel,
  models,
  setSelectModel,
}: AdvancedSettingsProps) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className="advanced-settings" ref={rootRef}>
      <button
        className="advanced-trigger"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="true"
        // 图标按钮没有可见文字，必须给无障碍名，否则读屏只会念"按钮"。
        // title 给鼠标用户，aria-label 给读屏——两个都要，它们服务的是不同的人。
        aria-label="Advanced settings"
        title="Advanced settings"
      >
        <Settings2 size={16} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="advanced-panel">
          <div className="advanced-panel-label">Model</div>
          <ModelSelector
            selectModel={selectModel}
            models={models}
            setSelectModel={setSelectModel}
            className="advanced-model"
          />
        </div>
      )}
    </div>
  );
}
