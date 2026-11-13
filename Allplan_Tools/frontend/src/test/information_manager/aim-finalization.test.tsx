import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import repeated from "../fixtures/aim-update/12-add-repeated-occurrence-updated.json";
import identity from "../fixtures/aim-update/21-host-identity-update.json";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import { AimMessageDialog } from "@/modules/information_manager/components/aim-message-dialog";
import { askAimDiscard } from "@/modules/information_manager/lib/aim-choice";
import { useAppDialog } from "@/lib/app-dialog";
import { EXPORT_SYNC_TIMEOUT_MS, presentationExportAvailable, waitForPresentationSync } from "@/modules/information_manager/lib/aim-export";

const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async original => ({ ...await original<object>(), getVerifiedAppInfo: () => host.info }));
const flush = async () => { await act(async () => { for (let i = 0; i < 35; i++) await Promise.resolve(); }); };
const defer = <T,>() => { let resolve: (v: T) => void = () => {}; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("AIM discard resolves once and a concurrent request is immediately cancelled", async () => {
  render(<AimMessageDialog />);
  let first = Promise.resolve<string | null>(null), second = first;
  act(() => { first = askAimDiscard("Perdre les modifications ?"); second = askAimDiscard("Concurrent"); });
  await expect(second).resolves.toBeNull();
  expect(useAppDialog.getState().queue).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Abandonner" }));
  await expect(first).resolves.toBe("discard");
  expect(useAppDialog.getState().queue).toHaveLength(0);
});
it.each(["Annuler", "Escape", "fond", "démontage"])("AIM %s cancels and releases the queue", async mode => {
  const mounted = render(<AimMessageDialog />);
  let answer = Promise.resolve<string | null>(null);
  act(() => { answer = askAimDiscard("Perdre les modifications ?"); });
  if (mode === "démontage") mounted.unmount();
  else if (mode === "Escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  else if (mode === "fond") {
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0');
    if (!overlay) throw new Error("Missing shared overlay");
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    fireEvent.pointerDown(overlay, { button: 0, ctrlKey: false });
    fireEvent.click(overlay);
  } else fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  await expect(answer).resolves.toBeNull();
  expect(useAppDialog.getState().queue).toEqual([]);
});

function initialWork() {
  const p = structuredClone(repeated.presentation);
  return { revision: 4, source: structuredClone(loaded), data: structuredClone(loaded.data), draftValues: { "7": "0" }, pendingImport: true, presentation: { ...p, model: { ...p.model, readOnly: false } }, dirty: { values: true, presentation: true, any: true }, fileSaveAvailable: false, prjtoolsAvailable: false };
}
async function mountExport(reply: unknown, enabled = true, updateReply?: Promise<unknown>) {
  host.info = { ...identity, read_only: false, working_state_contract: 1, ...(enabled ? { presentation_export_contract: 1 } : {}) };
  const work = initialWork();
  const call = vi.fn(async (command: string, payload: Record<string, unknown>) => {
    if (command === "work.get") return { ok: true, status: "current", work: structuredClone(work) };
    if (command === "presentation.update") {
      const result = updateReply ? await updateReply : { ok: true, status: "updated", presentation: work.presentation };
      if ((result as { ok?: boolean }).ok) {
        work.presentation.configuration = structuredClone(payload["configuration"]) as typeof work.presentation.configuration;
        work.revision++;
      }
      return result;
    }
    if (command === "presentation.export") return typeof reply === "function" ? reply(payload) : reply;
    throw new Error(command);
  });
  vi.stubGlobal("pywebview", { api: { get_initial_data: async () => structuredClone(loaded), call } });
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  return { call, work };
}
const exportButton = () => screen.getByRole("button", { name: "Exporter une présentation" });
const exported = { ok: true, status: "exported", fileName: "Presentation.json", configurationId: repeated.presentation.configuration.configurationId };
it("absent export capacity visibly disables action without probing Python", async () => {
  const { call } = await mountExport(exported, false);
  expect(screen.getByText(/Export JSON indisponible/)).toBeVisible();
  const button = screen.getByRole("button", { name: /Export JSON indisponible/ });
  expect(button).toBeDisabled(); fireEvent.click(button);
  expect(call.mock.calls.map(([c]) => c)).toEqual(["work.get"]);
  for (const marker of [true, "1", 0, 2, undefined]) expect(presentationExportAvailable({ ...identity, presentation_export_contract: marker })).toBe(false);
  expect(presentationExportAvailable({ ...identity, presentation_export_contract: 1 })).toBe(true);
});
it.each(["success", "cancelled"])("export %s sends exactly configuration and preserves the entire work state", async status => {
  const { call, work } = await mountExport(status === "success" ? exported : { ok: true, status: "cancelled" });
  const before = structuredClone(work);
  fireEvent.click(exportButton()); await flush();
  expect(call).toHaveBeenCalledWith("presentation.export", { configuration: before.presentation.configuration });
  expect(work).toEqual(before);
  expect(exportButton()).toBeEnabled();
  expect(screen.getAllByRole("textbox", { name: "Modifier la valeur 7" }).map(e => (e as HTMLInputElement).value)).toEqual(["0", "0"]);
  if (status === "success") expect(screen.getByText(/Copie de la présentation exportée : Presentation.json/)).toBeVisible();
  else expect(screen.queryByText(/Export annulé|Export non effectué/)).toBeNull();
});
const errors = ["file_write_forbidden", "presentation_required", "stale_presentation", "invalid_payload", "invalid_presentation", "unsupported_presentation_version", "dialog_unavailable", "unsupported_format", "protected_destination", "output_exists", "export_failed"];
it.each(errors)("export %s displays Python error, preserves dirty work and never retries", async code => {
  const { call, work } = await mountExport({ ok: false, error: { code, message: `Python: ${code}` } });
  const before = structuredClone(work);
  fireEvent.click(exportButton()); await flush();
  expect(screen.getByText(new RegExp(`Python: ${code}`))).toBeVisible();
  expect(work).toEqual(before);
  expect(call.mock.calls.filter(([c]) => c === "presentation.export")).toHaveLength(1);
  expect(exportButton()).toBeEnabled();
});
it("in-flight update disables export; only the accepted configuration is exported afterwards", async () => {
  const sync = defer<unknown>();
  const { call, work } = await mountExport(exported, true, sync.promise);
  fireEvent.click(screen.getByRole("button", { name: /Tout replier.*Synthetic group/ })); await flush();
  expect(screen.getByRole("button", { name: /Une opération ou une synchronisation/ })).toBeDisabled();
  expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
  sync.resolve({ ok: true, status: "updated", presentation: work.presentation }); await flush();
  fireEvent.click(exportButton()); await flush();
  const update = call.mock.calls.find(([c]) => c === "presentation.update");
  const exp = call.mock.calls.find(([c]) => c === "presentation.export");
  expect(exp?.[1]).toEqual(update?.[1]);
  expect(work.revision).toBe(5);
});
it("failed update blocks export and retains unsynchronized dirty draft", async () => {
  const sync = defer<unknown>();
  const { call, work } = await mountExport(exported, true, sync.promise);
  fireEvent.click(screen.getByRole("button", { name: /Tout replier.*Synthetic group/ })); await flush();
  sync.resolve({ ok: false, error: { code: "invalid_presentation", message: "Synchronisation refusée" } }); await flush();
  expect(screen.getByRole("alert", { name: "presentation-update" })).toHaveTextContent("Synchronisation refusée");
  expect(screen.getByRole("button", { name: /La présentation affichée n'est pas synchronisée/ })).toBeDisabled();
  expect(work.dirty.any).toBe(true); expect(work.revision).toBe(4);
  expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
});
it.each([true, false])("update starting between export click and dispatch must succeed (%s) before any export", async accepted => {
  const sync = defer<unknown>();
  const { call, work } = await mountExport(exported, true, sync.promise);
  const collapse = screen.getByRole("button", { name: /Tout replier.*Synthetic group/ });
  act(() => { fireEvent.click(exportButton()); fireEvent.click(collapse); });
  await flush();
  expect(call.mock.calls.filter(([c]) => c === "presentation.update")).toHaveLength(1);
  expect(call.mock.calls.some(([c]) => c === "presentation.export")).toBe(false);
  sync.resolve(accepted ? { ok: true, status: "updated", presentation: work.presentation } : { ok: false, error: { code: "invalid_presentation", message: "Synchronisation refusée" } });
  await flush();
  expect(call.mock.calls.filter(([c]) => c === "presentation.export")).toHaveLength(accepted ? 1 : 0);
  if (accepted) expect(call.mock.calls.find(([c]) => c === "presentation.export")?.[1]).toEqual(call.mock.calls.find(([c]) => c === "presentation.update")?.[1]);
  else expect(screen.getByRole("alert", { name: "presentation-update" })).toHaveTextContent("Synchronisation refusée");
});
it("native save dialog prevents repeated clicks and releases export on communication failure", async () => {
  const native = defer<unknown>();
  const { call } = await mountExport(() => native.promise);
  const button = exportButton(); fireEvent.click(button); fireEvent.click(button); await flush();
  expect(call.mock.calls.filter(([c]) => c === "presentation.export")).toHaveLength(1);
  native.resolve({ ok: false, error: { code: "dialog_unavailable", message: "Dialogue indisponible" } }); await flush();
  expect(exportButton()).toBeEnabled();
});
it("synchronization wait is bounded to 15000ms and clears its timer", async () => {
  vi.useFakeTimers();
  expect(EXPORT_SYNC_TIMEOUT_MS).toBe(15000);
  const task = waitForPresentationSync(new Promise<void>(() => {}));
  const assertion = expect(task).rejects.toThrow("aucun export envoyé");
  await vi.advanceTimersByTimeAsync(15000); await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
it.each([true, false])("scheduled debounce waits for update acceptance (%s), preserving dirty state", async accepted => {
  vi.useFakeTimers();
  const work = initialWork();
  const before = structuredClone(work);
  const configuration = structuredClone(work.presentation.configuration);
  const group = configuration.categories[0]?.groups[0];
  if (!group) throw new Error("Missing synthetic group");
  group.expanded = false;
  let acceptUpdate: () => void = () => {};
  let rejectUpdate: (reason: Error) => void = () => {};
  const acknowledgement = new Promise<void>((resolve, reject) => { acceptUpdate = resolve; rejectUpdate = reject; });
  const update = vi.fn(() => acknowledgement);
  const exportCall = vi.fn();
  // The existing AIM update path has no production debounce. This fixture models
  // a scheduled producer's whole lifetime, including time before its first call.
  const scheduled = new Promise<void>((resolve, reject) => {
    setTimeout(() => { update().then(resolve, reject); }, 300);
  });
  const attempt = waitForPresentationSync(scheduled).then(() => exportCall({ configuration })).catch(() => undefined);
  await vi.advanceTimersByTimeAsync(299);
  expect(update).not.toHaveBeenCalled();
  expect(exportCall).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(update).toHaveBeenCalledTimes(1);
  expect(exportCall).not.toHaveBeenCalled();
  if (accepted) acceptUpdate();
  else rejectUpdate(new Error("Synchronisation refusée"));
  await attempt;
  expect(exportCall).toHaveBeenCalledTimes(accepted ? 1 : 0);
  if (accepted) expect(exportCall).toHaveBeenCalledWith({ configuration });
  expect(work).toEqual(before);
});