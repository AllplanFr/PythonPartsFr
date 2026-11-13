import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SuiteMenu } from "@/modules/information_manager/components/suite-menu";
import { DICTS } from "@/modules/information_manager/lib/i18n";
import { interfaceText } from "@/modules/information_manager/lib/aim-interface";

afterEach(cleanup);
const t = DICTS.fr;
const text = interfaceText("fr");
function mount(importDisabled?: string) {
  const callbacks = { onImport: vi.fn(), onExport: vi.fn(), onSave: vi.fn(), onQuit: vi.fn(), onAbout: vi.fn(), onBackups: vi.fn() };
  render(<SuiteMenu t={t} text={text} importDisabled={importDisabled} {...callbacks} />);
  fireEvent.keyDown(screen.getByRole("button", { name: t.appName }), { key: "Enter" });
  return callbacks;
}
it.each([
  [text.importPresentation, "onImport"],
  [t.about, "onAbout"],
  [t.quit, "onQuit"],
] as const)("preserves the existing %s callback", (label, callback) => {
  const callbacks = mount();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  expect(callbacks[callback]).toHaveBeenCalledTimes(1);
  for (const [name, action] of Object.entries(callbacks)) {
    if (name !== callback) expect(action).not.toHaveBeenCalled();
  }
});
it("preserves unavailable import and disk operations without calling them", () => {
  const callbacks = mount("Indisponible");
  for (const label of [text.importPresentation, text.exportPresentation, t.save, text.backups]) {
    fireEvent.click(screen.getByRole("menuitem", { name: label }));
  }
  for (const action of Object.values(callbacks)) expect(action).not.toHaveBeenCalled();
});