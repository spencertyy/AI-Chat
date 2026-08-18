import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { useState } from "react";
import InputArea from "./InputArea"; // ← 默认导出，所以不加 { }

// ModelSelector 移进了输入框底部工具排，story 也要喂模型数据
const fakeModels = [
  { label: "Gemini", id: "gemini-story", provider: "gemini", icon: "/g.png" },
  { label: "GPT", id: "gpt-story", provider: "openai", icon: "/o.png" },
];

const meta = {
  title: "Components/InputArea",
  component: InputArea,
  parameters: { layout: "padded" }, // padded：四周留白（输入框是宽组件，不居中更自然）
  tags: ["autodocs"],
  // 这里的 args 是"所有 story 共享的默认值"——回调全用 fn() mock
  args: {
    setInput: fn(),
    handleSend: fn(),
    handleStop: fn(),
    selectModel: fakeModels[0],
    models: fakeModels,
    setSelectModel: fn(),
  },
} satisfies Meta<typeof InputArea>;

export default meta;
type Story = StoryObj<typeof meta>;

// 空输入、未加载 → 显示 ↑ 发送按钮
export const Default: Story = {
  args: {
    input: "",
    isLoading: false,
  },
};

// 输入框里有文字
export const WithText: Story = {
  args: {
    input: "Explain how SSE streaming works",
    isLoading: false,
  },
};

// 关键分支：isLoading=true → 组件渲染 ■ 停止按钮（而非 ↑）
export const Loading: Story = {
  args: {
    input: "Generating a response...",
    isLoading: true,
  },
};

// 交互版：用 render 函数包一层 useState，让输入框真正能打字
export const Interactive: Story = {
  render: (args) => {
    // 这个 useState 就是 story 内部造的"假父组件"，接管受控输入的状态
    const [input, setInput] = useState("");
    return <InputArea {...args} input={input} setInput={setInput} />;
  },
  args: {
    input: "",
    isLoading: false,
  },
};
