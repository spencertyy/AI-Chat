"use client";

import { useState } from "react";

// 人格头像。优先渲染图片（persona.avatar），图片没配置或加载失败时回退到 emoji。
//
// onError 兜底是关键：avatar 填了但文件不存在、或外链挂了，也不会显示裂图，
// 而是平滑退回 emoji——头像永远有得显示。这也是为什么 emoji 字段永远必填。
type AvatarProps = {
  /** 图片路径，可选。不填或加载失败时用 emoji */
  src?: string;
  /** 兜底 emoji */
  emoji: string;
  /** 无障碍用的可读名字（人格名） */
  name: string;
};

export default function Avatar({ src, emoji, name }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 头像是小图、src 可能是动态路径，原生 img 足够；项目其余头像（AuthButton/ModelSelector）同样用 img
      <img
        className="ai-avatar-img"
        src={src}
        alt={name}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span role="img" aria-label={name}>
      {emoji}
    </span>
  );
}
