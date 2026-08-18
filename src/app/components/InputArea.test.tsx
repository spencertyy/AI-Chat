import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputArea from "./InputArea";

// 用假组件替换 metal-fx（它在 jsdom 跑不了）
jest.mock("metal-fx", () => ({
  MetalFx: ({ children }: { children: React.ReactNode }) => children,
}));

// ModelSelector 现在渲染在输入框底部工具排里，props 工厂要喂给它模型数据
const fakeModels = [
  { label: "Gemini", id: "gemini-test", provider: "gemini", icon: "/g.png" },
  { label: "GPT", id: "gpt-test", provider: "openai", icon: "/o.png" },
];

function setup(overrides = {}) {
  const props = {
    input: "",
    setInput: jest.fn(),
    handleSend: jest.fn(),
    isLoading: false,
    handleStop: jest.fn(),
    selectModel: fakeModels[0],
    models: fakeModels,
    setSelectModel: jest.fn(),
    ...overrides,
  };
  render(<InputArea {...props} />);
  return props;
}

describe("InputArea", () => {
  it("calls setInput when typing", async () => {
    const props = setup();
    await userEvent.type(
      screen.getByPlaceholderText("What happened? Tell me the situation…"),
      "a",
    );
    expect(props.setInput).toHaveBeenCalledWith("a");
  });

  it("calls handleSend when Enter is pressed", async () => {
    const props = setup();
    await userEvent.type(
      screen.getByPlaceholderText("What happened? Tell me the situation…"),
      "{Enter}",
    );
    expect(props.handleSend).toHaveBeenCalled();
  });

  it("does NOT send on Shift+Enter", async () => {
    const props = setup();
    await userEvent.type(
      screen.getByPlaceholderText("What happened? Tell me the situation…"),
      "{Shift>}{Enter}{/Shift}",
    );
    expect(props.handleSend).not.toHaveBeenCalled();
  });

  it("calls handleSend when the send button is clicked", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("button", { name: "↑" }));
    expect(props.handleSend).toHaveBeenCalled();
  });
});
