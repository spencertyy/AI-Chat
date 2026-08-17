import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InputArea from "./InputArea";

// 用假组件替换 metal-fx（它在 jsdom 跑不了）
jest.mock("metal-fx", () => ({
  MetalFx: ({ children }: { children: React.ReactNode }) => children,
}));

function setup(overrides = {}) {
  const props = {
    input: "",
    setInput: jest.fn(),
    handleSend: jest.fn(),
    isLoading: false,
    handleStop: jest.fn(),
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
