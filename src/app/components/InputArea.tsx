import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPaperclip } from "@fortawesome/free-solid-svg-icons";
import { faImage } from "@fortawesome/free-solid-svg-icons";
import { MetalFx } from "metal-fx";
import { useTheme } from "../hooks/useTheme";

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
  const { theme } = useTheme();
  return (
    <div className="input-area">
      <div className="input-wrapper">
        <div className="input-box">
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
          <div className="input-footer">
            <button className="file-upload">
              <FontAwesomeIcon icon={faPaperclip} />
            </button>
            <button className="image-upload">
              <FontAwesomeIcon icon={faImage} />
            </button>
            <div className="send-btn-wrapper">
              {/* theme 必须显式传：MetalFx 默认的 "auto" 是查
                  matchMedia('(prefers-color-scheme: dark)')，也就是【系统】偏好，
                  而不是我们 <html data-theme> 上的值。用户手动切浅色但系统是深色时，
                  不传这个属性它就会继续画深色金属，跟界面对不上。*/}
              <MetalFx
                preset="chromatic"
                variant="circle"
                strength={0.45}
                theme={theme}
              >
                {isLoading ? (
                  <button className="send-btn stop-btn" onClick={handleStop}>
                    ■
                  </button>
                ) : (
                  <button className="send-btn" onClick={() => handleSend()}>
                    ↑
                  </button>
                )}
              </MetalFx>
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
