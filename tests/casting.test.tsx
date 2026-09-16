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
      <Casting modes={["single", "characters"]} models={["openrouter/test"]} voices={VOICES} value={{}} onChange={noop} />,
    );
    expect(screen.getByLabelText("Narrator")).toBeTruthy();
    expect(screen.getByLabelText("Unknown speaker")).toBeTruthy();
    expect(screen.getByLabelText("Casting method")).toBeTruthy();
    expect(screen.getByLabelText("Attribution model")).toBeTruthy();
    expect((screen.getByLabelText("Attribution model") as HTMLSelectElement).value).toBe("openrouter/test");
  });

  test("VCTK voices carry attribution, license, and modification notice", () => {
    const voices = [
      {
        id: "aoife",
        name: "Aoife",
        language: "english",
        licenseId: "CC-BY-4.0",
        voiceRights: "Derived from VCTK.",
      },
    ];
    render(
      <Casting modes={["single", "characters"]} models={["model"]} voices={voices} value={{}} onChange={noop} />,
    );
    expect(screen.getByText(/CSTR VCTK Corpus/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "CC BY 4.0" }).getAttribute("href")).toBe(
      "https://creativecommons.org/licenses/by/4.0/",
    );
    expect(screen.getByText(/modified by Kyutai and Kenkui/)).toBeTruthy();
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
