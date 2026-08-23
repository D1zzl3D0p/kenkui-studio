import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { Casting } from "../src/components/casting";

const VOICES = [
  { id: "eponine", name: "Eponine", language: "english" },
  { id: "charles", name: "Charles", language: "english" },
];

const noop = () => {};

describe("Casting", () => {
  test("a single-mode server offers no character controls", () => {
    render(<Casting modes={["single"]} voices={VOICES} value={{}} onChange={noop} />);
    expect(screen.queryByLabelText("Casting method")).toBeNull();
    expect(screen.queryByLabelText("Attribution model")).toBeNull();
  });

  test("a character-capable server offers narrator, unknown, method, and model", () => {
    render(
      <Casting modes={["single", "characters"]} voices={VOICES} value={{}} onChange={noop} />,
    );
    expect(screen.getByLabelText("Narrator")).toBeTruthy();
    expect(screen.getByLabelText("Unknown speaker")).toBeTruthy();
    expect(screen.getByLabelText("Casting method")).toBeTruthy();
    expect(screen.getByLabelText("Attribution model")).toBeTruthy();
  });

  test("unknown speaker defaults to following the narrator", () => {
    render(
      <Casting
        modes={["single", "characters"]}
        voices={VOICES}
        value={{ narratorVoiceId: "eponine" }}
        onChange={noop}
      />,
    );
    const unknown = screen.getByLabelText("Unknown speaker") as HTMLSelectElement;
    expect(unknown.value).toBe("");
  });

  test("no per-character override controls exist in v1", () => {
    render(
      <Casting modes={["single", "characters"]} voices={VOICES} value={{}} onChange={noop} />,
    );
    expect(screen.queryByTestId("character-override")).toBeNull();
  });

  test("choosing a narrator reports it", () => {
    const onChange = vi.fn();
    render(
      <Casting modes={["single", "characters"]} voices={VOICES} value={{}} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText("Narrator"), { target: { value: "charles" } });
    expect(onChange).toHaveBeenCalledWith({ narratorVoiceId: "charles" });
  });
});
