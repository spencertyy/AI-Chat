import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperclip } from "@fortawesome/free-solid-svg-icons";
import { faImage } from "@fortawesome/free-solid-svg-icons";
// neobrutalism 试水期停用金属流光。恢复金属版：取消下面两行 import、
// 下方的 useTheme() 调用、以及发送按钮外层 <MetalFx> 的注释。
// import { MetalFx } from "metal-fx";
// import { useTheme } from "../hooks/useTheme";

type InputAreaProps = {
  input: string;
  setInput: (value: string) => void;
  handleSend: () => void;
  isLoading: boolean;
  handleStop: () => void;
};

export default function InputArea({
  input,
  setInput,
  handleSend,
  isLoading,
  handleStop,
}: InputAreaProps) {
  // const { theme } = useTheme();
  return (
    <div className="input-area">
      <div className="input-wrapper">
        <div className="input-box">
          <input
            className="input"
            type="text"
            placeholder="What happened? Tell me the situation…"
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
          <div className="input-footer">
            <button className="file-upload">
              <FontAwesomeIcon icon={faPaperclip} />
            </button>
            <button className="image-upload">
              <FontAwesomeIcon icon={faImage} />
            </button>
            <div className="send-btn-wrapper">
              {/* neobrutalism 试水：去掉外层 <MetalFx>（金属流光与哑光硬边互斥）。
                  恢复金属版：把下面按钮用
                  <MetalFx preset="chromatic" variant="circle" strength={0.45} theme={theme}>
                  重新包起来，并恢复顶部 import 与 useTheme()。*/}
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
        </div>
        <p className="ai-disclaimer">
          AI may make mistakes, Please verify important information.
        </p>
      </div>
    </div>
  );
}
