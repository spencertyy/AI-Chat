import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { fn } from "storybook/test";
import { useState } from "react";
import PersonaSelector from "./PersonaSelector";
import { PERSONAS } from "../lib/personas";
import type { Persona } from "../types/chat";

// 这里用**真实的** PERSONAS，与单元测试相反。
// 两者目的不同：测试要的是稳定的断言基准，所以自造数据；story 是给人看的
// 展板，用真内容才能一眼看出每个人格的定位读起来是否清楚、tagline 会不会
// 把菜单撑得太宽。文案审校本来就是这个 story 存在的理由之一。
const meta = {
  title: "Components/PersonaSelector",
  component: PersonaSelector,
  // padded 而不是 centered：菜单是向下展开的绝对定位层，
  // 居中会让它贴着画布边缘，看不出真实位置关系。
  parameters: { layout: "padded" },
  tags: ["autodocs"],
  args: {
    personas: PERSONAS,
    setSelectPersona: fn(),
  },
} satisfies Meta<typeof PersonaSelector>;

export default meta;
type Story = StoryObj<typeof meta>;

const byId = (id: string) => PERSONAS.find((p) => p.id === id)!;

/** 默认态：Savage 选中，菜单收起 */
export const Default: Story = {
  args: { selectPersona: byId("savage") },
};

export const Gentle: Story = {
  args: { selectPersona: byId("gentle") },
};

export const Veteran: Story = {
  args: { selectPersona: byId("veteran") },
};

/** 通用问答被选中——它是 kind: "assistant"，在菜单里位于分隔线之下 */
export const StraightUp: Story = {
  args: { selectPersona: byId("plain") },
};

/**
 * 交互版：用 useState 造一个假父组件接管选中状态，这样在 Storybook 里
 * 真的能切人格、看到勾选位置和触发器文字同步变化。
 * 菜单的展开状态是组件内部 state，只能靠点击触发，没法用 args 直接摆出来。
 */
export const Interactive: Story = {
  render: (args) => {
    const [selected, setSelected] = useState<Persona>(byId("savage"));
    return (
      <PersonaSelector
        {...args}
        selectPersona={selected}
        setSelectPersona={setSelected}
      />
    );
  },
  args: { selectPersona: byId("savage") },
};

/**
 * 只有军师人格时不渲染分隔线——分隔线的意义是"下面这个是另一类东西"，
 * 没有另一类就不该画。
 */
export const AdvisorsOnly: Story = {
  args: {
    selectPersona: byId("savage"),
    personas: PERSONAS.filter((p) => p.kind === "advisor"),
  },
};
