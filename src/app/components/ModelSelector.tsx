import { useState } from "react";
import { Model } from "../types/chat";
import { ChevronDown } from "lucide-react";

type ModelSelectorProps = {
  selectModel: Model;
  models: Model[];
  setSelectModel: (model: Model) => void;
  // 额外 class，方便在不同位置（如 header）套不同样式
  className?: string;
};

// 公开 demo 上只放行 Gemini：它走免费额度，最坏结果是 429；
// OpenAI 是纯付费的，每个 token 都是真金白银。
//
// 保留在列表里而不是隐藏，是为了让访客看到多模型切换这个功能确实存在，
// 同时说明为什么用不了——直接消失会让人以为功能没做。
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
// 短句：这行是常驻可见的副标题，不是悬停才出现的提示。菜单项设了
// white-space: nowrap，文案太长会把整个下拉框撑宽。
const DISABLED_HINT = "Disabled to control API cost";

export default function ModelSelector({
  selectModel,
  models,
  setSelectModel,
  className = "",
}: ModelSelectorProps) {
  const [showModelMenu, setShowModelMenu] = useState(false);

  return (
    <div className={`model-selector ${className}`}>
      <button
        className="multi-model"
        onClick={() => setShowModelMenu(!showModelMenu)}
      >
        {/* 空 alt 是刻意的：紧邻的文字已经写着模型名，图标纯装饰。
            空 alt 明确告诉读屏"跳过我"，与"没有 alt"完全不同——
            后者会让部分读屏去念图片 URL。*/}
        <img
          src={selectModel.icon}
          alt=""
          width={16}
          height={16}
          className="model-icon"
        />
        {selectModel.label}
        <ChevronDown size={16} strokeWidth={1.5} />
      </button>
      {showModelMenu && (
        <div className="model-menu">
          {models.map((model) => {
            const unavailable = DEMO_MODE && model.provider !== "gemini";
            return (
              <button
                key={model.id}
                className="model-option"
                // 用 aria-disabled 而不是 disabled：disabled 会把按钮移出 Tab
                // 顺序，键盘和读屏用户根本发现不了它，也听不到任何解释；而且
                // 多数浏览器不对 disabled 元素派发鼠标事件，title 提示也弹不出来。
                // aria-disabled 只声明状态，元素仍可聚焦、仍能显示提示。
                aria-disabled={unavailable}
                onClick={() => {
                  if (unavailable) return; // 状态是声明的，拦截要自己做
                  setSelectModel(model);
                  setShowModelMenu(false);
                }}
              >
                <img
                  src={model.icon}
                  alt=""
                  width={16}
                  height={16}
                  className="model-icon"
                />
                {/* 禁用的原因写成常驻副标题，而不是 title 提示：
                    原生 title 要悬停一两秒才弹、样式不可控、触屏上根本不出现。
                    信息重要到值得说，就该一直看得见。
                    副标题在 DOM 里就在按钮内部，读屏聚焦时会连同标题一起播报，
                    不需要额外的 aria-describedby 关联。*/}
                <span className="model-label">
                  {model.label}
                  {unavailable && (
                    <span className="model-option-hint">{DISABLED_HINT}</span>
                  )}
                </span>
                {unavailable && (
                  <span className="model-unavailable-tag">demo</span>
                )}
                {model.id === selectModel.id && (
                  <span className="model-check">✓</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
