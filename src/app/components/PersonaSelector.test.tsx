import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PersonaSelector from "./PersonaSelector";
import type { Persona } from "../types/chat";

// 自造人格而不是引真实的 PERSONAS：真人格的名字和 tagline 会随产品迭代改
// （"Straight Up" 就是从 "Assistant" 改来的），拿它当断言基准的话，
// 改一句文案就会莫名挂掉一批测试。测的是**组件行为**，不是当下的配置。
const base = {
  emoji: "🙂",
  defaultModelId: "gemini-3.1-flash-lite",
  identity: "",
  style: "",
  strategy: "",
  bannedPhrases: { draft: [], all: [] },
};

const personas: Persona[] = [
  {
    ...base,
    id: "alpha",
    kind: "advisor",
    name: "Alpha",
    tagline: "First advisor",
  },
  {
    ...base,
    id: "beta",
    kind: "advisor",
    name: "Beta",
    tagline: "Second advisor",
  },
  {
    ...base,
    id: "plainish",
    kind: "assistant",
    name: "Plainish",
    tagline: "Not an advisor",
  },
];

function setup(
  overrides: Partial<React.ComponentProps<typeof PersonaSelector>> = {},
) {
  const setSelectPersona = jest.fn();
  render(
    <PersonaSelector
      selectPersona={personas[0]}
      personas={personas}
      setSelectPersona={setSelectPersona}
      {...overrides}
    />,
  );
  return { setSelectPersona };
}

/** 菜单项按无障碍名字取——它是 "名字 — 定位"，与触发器上的裸名字区分得开 */
const option = (name: string, tagline: string) =>
  screen.getByRole("button", { name: `${name} — ${tagline}` });

describe("PersonaSelector", () => {
  it("shows the current persona and keeps the menu closed initially", () => {
    setup();
    expect(screen.getByRole("button", { name: /Alpha/ })).toBeInTheDocument();
    expect(screen.queryByText("Second advisor")).not.toBeInTheDocument();
  });

  it("opens the menu on click and lists every persona", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(option("Alpha", "First advisor")).toBeInTheDocument();
    expect(option("Beta", "Second advisor")).toBeInTheDocument();
    expect(option("Plainish", "Not an advisor")).toBeInTheDocument();
  });

  it("reports the selected option with aria-pressed", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(option("Alpha", "First advisor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(option("Beta", "Second advisor")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("calls setSelectPersona and closes the menu when an option is picked", async () => {
    const { setSelectPersona } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    await userEvent.click(option("Beta", "Second advisor"));

    expect(setSelectPersona).toHaveBeenCalledWith(personas[1]);
    // 选完就收起来，不需要用户再点一次关闭
    expect(screen.queryByText("Second advisor")).not.toBeInTheDocument();
  });

  // 下面两条是这个组件比 ModelSelector 多做的部分（ModelSelector 点外面
  // 和按 Esc 都关不掉菜单，是它的短板）。行为照 AuthButton 的模式实现。
  it("closes on an outside click", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.getByText("Second advisor")).toBeInTheDocument();

    await userEvent.click(document.body);
    expect(screen.queryByText("Second advisor")).not.toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Second advisor")).not.toBeInTheDocument();
  });

  // 点触发器第二下应该关闭。这条容易写坏：如果"点击外部"的监听没把触发器
  // 本身算作内部，会先被 document 监听关掉、再被按钮自身 toggle 打开，
  // 于是菜单永远关不掉。
  it("toggles closed when the trigger is clicked again", async () => {
    setup();
    const trigger = screen.getByRole("button", { name: /Alpha/ });
    await userEvent.click(trigger);
    expect(screen.getByText("Second advisor")).toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.queryByText("Second advisor")).not.toBeInTheDocument();
  });

  // 军师人格和通用问答之间有一条分隔线——它们是不同种类的东西，
  // 平铺在一个列表里会让人以为通用问答只是"另一种语气"。
  it("separates advisors from the assistant with a divider", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.getByRole("separator")).toBeInTheDocument();
  });

  it("omits the divider when there is no assistant persona", async () => {
    setup({ personas: personas.filter((p) => p.kind === "advisor") });
    await userEvent.click(screen.getByRole("button", { name: /Alpha/ }));
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });
});
