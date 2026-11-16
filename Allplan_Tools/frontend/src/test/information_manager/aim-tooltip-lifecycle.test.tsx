import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppTooltips } from "@/modules/information_manager/components/app-tooltips";
import { UnavailableRowActions } from "@/modules/information_manager/components/unavailable-row-actions";

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });
const advance = (ms = 350) => act(() => vi.advanceTimersByTime(ms));
function mount() {
  const view = render(<><AppTooltips /><button title="STR">Type<span>Child</span><span>Sibling</span></button><button title="Other">Other</button></>);
  return { ...view, target: screen.getByRole("button", { name: "Type Child Sibling" }), other: screen.getByRole("button", { name: "Other" }) };
}
const absent = () => expect(screen.queryByRole("tooltip")).toBeNull();
const shown = (text: string) => { expect(screen.getAllByRole("tooltip")).toHaveLength(1); expect(screen.getByRole("tooltip")).toHaveTextContent(text); };

it.each([349, 350])("hover alone closes on real exit at %s ms and cancels any late help", ms => {
  const { target } = mount(); fireEvent.mouseOver(target); advance(ms);
  if (ms === 349) absent(); else shown("STR");
  fireEvent.mouseOut(target, { relatedTarget: document.body }); absent(); advance(); absent();
  expect(target).toHaveAttribute("title", "STR");
});
it("focus alone opens after exactly 350 ms, then blur closes", () => {
  const { target } = mount(); act(() => target.focus()); advance(349); absent(); advance(1); shown("STR");
  act(() => target.blur()); absent(); advance(); absent(); expect(target).toHaveAttribute("title", "STR");
});
it("retains focused help after pointer exit, including a pending delay", () => {
  const { target } = mount(); fireEvent.mouseOver(target); act(() => target.focus()); advance(200);
  fireEvent.mouseOut(target, { relatedTarget: document.body }); expect(target).toHaveFocus(); advance(150); shown("STR");
  fireEvent.mouseOver(target); fireEvent.mouseOut(target, { relatedTarget: document.body }); shown("STR");
  act(() => target.blur()); absent();
});
it("retains hovered help after focus leaves without restarting its delay", () => {
  const { target } = mount(); fireEvent.mouseOver(target); act(() => target.focus()); advance(200);
  act(() => target.blur()); advance(150); shown("STR");
  act(() => target.focus()); act(() => target.blur()); shown("STR");
  fireEvent.mouseOut(target, { relatedTarget: document.body }); absent();
});
it("focus wins over a distinct hovered trigger and returns to still-hovered help on blur", () => {
  const { target, other } = mount(); act(() => target.focus()); advance(); shown("STR");
  fireEvent.mouseOver(other); advance(); shown("STR");
  act(() => target.blur()); absent(); advance(349); absent(); advance(1); shown("Other");
  expect(target).toHaveAttribute("title", "STR");
});
it("focus replaces a distinct hovered trigger and hover resumes when focus leaves", () => {
  const { target, other } = mount(); fireEvent.mouseOver(target); advance(); shown("STR");
  act(() => other.focus()); absent(); advance(); shown("Other");
  act(() => other.blur()); absent(); advance(); shown("STR");
  expect(other).toHaveAttribute("title", "Other");
});
it("internal hover and focus transitions preserve the pending delay and visible help", () => {
  const { target } = mount(); const child = screen.getByText("Child"), sibling = screen.getByText("Sibling");
  fireEvent.mouseOver(child); advance(200);
  fireEvent.mouseOut(child, { relatedTarget: sibling }); fireEvent.mouseOver(sibling, { relatedTarget: child });
  advance(150); shown("STR");
  fireEvent.focusIn(child); fireEvent.focusOut(child, { relatedTarget: sibling }); fireEvent.focusIn(sibling, { relatedTarget: child });
  shown("STR"); fireEvent.mouseOut(sibling, { relatedTarget: target }); fireEvent.mouseOver(target, { relatedTarget: sibling }); shown("STR");
});
it.each(["pointerdown", "dragstart", "scroll", "resize"])("%s closes visible/pending help; retained focus/hover cannot reopen it", kind => {
  const { target } = mount(); fireEvent.mouseOver(target); act(() => target.focus()); advance(); shown("STR");
  const dismiss = () => {
    if (kind === "pointerdown") fireEvent.pointerDown(target);
    else if (kind === "dragstart") fireEvent.dragStart(target);
    else if (kind === "scroll") fireEvent.scroll(window);
    else fireEvent.resize(window);
  };
  dismiss(); absent(); expect(target).toHaveAttribute("title", "STR"); advance(700); absent();
  fireEvent.mouseOver(document.body); advance(); absent(); // Unrelated entry cannot revive retained focus.
  act(() => target.blur()); advance(); absent(); // A leave is not a fresh opening event.
  fireEvent.mouseOver(target); advance(200); dismiss(); advance(); absent();
  act(() => target.focus()); advance(); shown("STR");
});
it("changing target cancels the obsolete timer and restores its title immediately", () => {
  const { target, other } = mount(); fireEvent.mouseOver(target); advance(200);
  fireEvent.mouseOut(target, { relatedTarget: other }); fireEvent.mouseOver(other, { relatedTarget: target });
  expect(target).toHaveAttribute("title", "STR"); advance(150); absent(); advance(199); absent(); advance(1); shown("Other");
});
it.each([200, 350])("unmount at %s ms cancels help and restores stripped titles", ms => {
  const { target, unmount } = mount(); fireEvent.mouseOver(target); advance(ms);
  expect(target).not.toHaveAttribute("title"); unmount();
  expect(target).toHaveAttribute("title", "STR"); advance(700); absent();
});
it("V1 glyph transfers to disabled action support without activation or a late STR timer", () => {
  const mutation = vi.fn();
  render(<><AppTooltips /><div><span title="STR"><svg aria-label="ABC" /></span><UnavailableRowActions number="10" /></div></>);
  const glyph = screen.getByLabelText("ABC"), support = screen.getByLabelText("Éditer 10 — Non disponible");
  fireEvent.mouseOver(glyph); advance(); shown("STR");
  fireEvent.mouseOut(glyph, { relatedTarget: support }); fireEvent.mouseOver(support, { relatedTarget: glyph }); absent();
  advance(349); absent(); advance(1); shown("Non disponible");
  fireEvent.mouseOut(support, { relatedTarget: document.body }); absent(); advance(); absent();
  act(() => support.focus()); advance(); shown("Non disponible");
  for (const action of ["Éditer", "Supprimer"]) {
    const button = screen.getByRole("button", { name: `${action} 10` });
    expect(button).toBeDisabled(); button.addEventListener("click", mutation); button.click();
  }
  expect(mutation).not.toHaveBeenCalled(); act(() => support.blur()); absent();
  expect(glyph.closest("[title]")).not.toHaveAttribute("tabindex");
});
it("focusable descendant resolves its help support and survives pointer exit until blur", () => {
  render(<><AppTooltips /><span title="Parent help"><button>Nested</button></span><button>Elsewhere</button></>);
  const child = screen.getByRole("button", { name: "Nested" }); fireEvent.mouseOver(child); act(() => child.focus()); advance(); shown("Parent help");
  fireEvent.mouseOut(child, { relatedTarget: document.body }); shown("Parent help");
  act(() => screen.getByRole("button", { name: "Elsewhere" }).focus()); absent(); advance(); absent();
});
it("actual focus transitions between descendants preserve the same trigger's delay", () => {
  render(<><AppTooltips /><span title="Shared support"><button>First</button><button>Second</button></span></>);
  act(() => screen.getByRole("button", { name: "First" }).focus()); advance(200);
  act(() => screen.getByRole("button", { name: "Second" }).focus()); advance(150); shown("Shared support");
  act(() => screen.getByRole("button", { name: "First" }).focus()); shown("Shared support");
});
it("rich data-tip retains its native title and restores a previous plain-title target", () => {
  render(<><AppTooltips /><button title="Plain">Plain</button><span data-tip={'Attribute\n#Details\n=Type|STR'} title="Native rich"><button>Rich child</button></span></>);
  const plain = screen.getByRole("button", { name: "Plain" }), child = screen.getByRole("button", { name: "Rich child" });
  fireEvent.mouseOver(plain); advance(); shown("Plain"); act(() => child.focus()); absent();
  expect(plain).toHaveAttribute("title", "Plain"); advance(); shown("Attribute"); expect(screen.getByRole("tooltip")).toHaveTextContent("Details");
  expect(child.parentElement).toHaveAttribute("title", "Native rich"); act(() => child.blur()); advance(); shown("Plain");
});
