import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
// 语法高亮的配色是一整个 JS 对象（每个 token 类型一条规则），
// 不是 CSS 变量能覆盖的——所以浅色模式必须换主题对象，而不是改 token。
import {
  oneDark,
  oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "../hooks/useTheme";
import { faCopy } from "@fortawesome/free-regular-svg-icons";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { useState } from "react";

function CodeBlock({ language, code }: { language: string; code: string }) {
  const langConfig: Record<
    string,
    { abbr: string; bg: string; color: string }
  > = {
    javascript: { abbr: "JS", bg: "#f7df1e", color: "#000" },
    typescript: { abbr: "TS", bg: "#1a5276", color: "#5dade2" },
    python: { abbr: "PY", bg: "#1a3a4a", color: "#3572A5" },
    html: { abbr: "HTML", bg: "#6e1f0f", color: "#e34c26" },
    css: { abbr: "CSS", bg: "#0f2560", color: "#264de4" },
    json: { abbr: "JSON", bg: "#2d2d2d", color: "#aaaaaa" },
    bash: { abbr: "SH", bg: "#1a3a1a", color: "#55c955" },
  };
  const config = langConfig[language?.toLowerCase()] ?? {
    abbr: language || "TEXT",
    bg: "#2d2d2d",
    color: "#aaaaaa",
  };

  const [copied, setCopied] = useState(false);
  const { theme } = useTheme();
  return (
    <div className="code-wrap">
      <div className="code-header">
        <div className="lang-info">
          <span
            className="lang-badge"
            style={{ background: config.bg, color: config.color }}
          >
            {config.abbr}
          </span>
          <span className="lang-name">{language || "text"}</span>
        </div>
        <button
          className={`copy-btn ${copied ? "copied" : ""}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              console.error("Failed to copy code to clipboard.");
            }
          }}
          title="Copy code"
        >
          {copied ? (
            "✓ Copied"
          ) : (
            <>
              <FontAwesomeIcon icon={faCopy} /> Copy
            </>
          )}
        </button>
      </div>
      <SyntaxHighlighter
        style={theme === "light" ? oneLight : oneDark}
        language={language}
        customStyle={{ background: `var(--color-code-bg)`, margin: 0 }}
        codeTagProps={{ style: { background: `var(--color-code-bg)` } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export { CodeBlock };
