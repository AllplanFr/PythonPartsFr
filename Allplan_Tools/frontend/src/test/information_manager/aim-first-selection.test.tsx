import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import type { WireProjectState, WorkingState } from "@/modules/information_manager/contracts/AIM_PROJECT_MANAGER_CONTRACT";
import { isWorkingState } from "@/modules/information_manager/lib/aim-working-contract";
import loaded from "../fixtures/aim-update/01-project-loaded.json";
import identity from "../fixtures/aim-update/21-host-identity-update.json";

const host = vi.hoisted(() => ({ info: null as unknown }));
vi.mock("@/shared/transport/native-binding", async original => ({ ...await original<object>(), getVerifiedAppInfo: () => host.info }));
const flush = async () => { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); }); };
function deferred() {
  let resolve: (value: unknown) => void = () => { throw new Error("not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("not initialized"); };
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function snapshot(selection: WireProjectState["selection"] = "required"): WireProjectState {
  const source = structuredClone(loaded) as unknown as WireProjectState;
  if (selection !== "accepted") {
    source.project = null; source.installation = null; source.data = { attributes: [] };
    source.definitions = { status: "not_loaded" };
    source.prjatt = { status: "not_loaded", path: null, encodingHint: null, header: null };
  }
  source.selection = selection;
  return source;
}
function work(source = snapshot(), revision = 7): WorkingState {
  return { revision, source, data: structuredClone(source.data), draftValues: {}, pendingImport: false, presentation: null,
    dirty: { values: false, presentation: false, any: false }, fileSaveAvailable: false, prjtoolsAvailable: false };
}
const current = (value: WorkingState) => ({ ok: true, status: "current", work: value });
const cancelled = () => ({ ok: true, status: "cancelled", data: snapshot() });
const choose = () => screen.getByRole("button", { name: "Choisir un projet Allplan" });
function binding(initial: unknown = snapshot(), initialWork: unknown = current(work())) {
  const transition = deferred();
  const get = vi.fn(async () => initialWork);
  const call = vi.fn(async (command: string, _payload: unknown): Promise<unknown> => {
    if (command === "work.get") return get();
    if (command === "work.transition") return transition.promise;
    throw new Error(`Unexpected command: ${command}`);
  });
  const getInitial = vi.fn(async () => initial);
  vi.stubGlobal("pywebview", { api: { get_initial_data: getInitial, call } });
  return { transition, get, call, getInitial, openings: () => call.mock.calls.filter(([command]) => command === "work.transition") };
}
beforeEach(() => {
  host.info = { ...identity, read_only: false, working_state_contract: 1 };
  vi.useFakeTimers(); localStorage.clear(); localStorage.setItem("information_manager:lang", "fr");
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("adopts successful work.get before exactly one protected opening, with the Python revision", async () => {
  const ready = deferred(); const b = binding(snapshot(), ready.promise);
  expect(isWorkingState(work())).toBe(true);
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(b.openings()).toHaveLength(0);
  fireEvent.click(choose()); await flush(); expect(b.openings()).toHaveLength(0);
  await act(async () => ready.resolve(current(work()))); await flush();
  expect(b.call.mock.calls).toEqual([
    ["work.get", {}], ["work.transition", { revision: 7, discard: false, command: "project.select", payload: {} }],
  ]);
  expect(choose()).toBeDisabled();
  fireEvent.click(choose()); await flush(); expect(b.openings()).toHaveLength(1);
});
it("effect replay and normal rerenders do not duplicate automatic selection", async () => {
  const b = binding();
  const view = render(<StrictMode><AimEditor hostEnabled={false} limitedHost /></StrictMode>); await flush();
  expect(b.getInitial).toHaveBeenCalledTimes(1); expect(b.openings()).toHaveLength(1);
  view.rerender(<StrictMode><AimEditor hostEnabled={false} limitedHost /></StrictMode>); await flush();
  expect(b.openings()).toHaveLength(1);
});
it("native user selection remains pending beyond both 15 and 30 seconds, then adopts success", async () => {
  const b = binding(); render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  for (const elapsed of [15001, 15001]) {
    await act(async () => { await vi.advanceTimersByTimeAsync(elapsed); });
    expect(b.openings()).toHaveLength(1); expect(b.get).toHaveBeenCalledTimes(1); expect(choose()).toBeDisabled();
  }
  const next = work(snapshot("accepted"), 8); b.get.mockResolvedValue(current(next));
  await act(async () => b.transition.resolve({ ok: true, status: "transitioned", work: next, result: { ok: true, data: next.source } })); await flush();
  expect(b.get).toHaveBeenCalledTimes(2); expect(choose()).toBeEnabled();
  expect(screen.getByLabelText("État des modifications")).toHaveAttribute("data-edit-state", "clean");
  expect(document.body.textContent).toContain("Synthetic.prj");
});
it("cancelled selection leaves no project, never reopens automatically, but allows manual retry once", async () => {
  const b = binding(); render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  await act(async () => b.transition.resolve(cancelled())); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(b.openings()).toHaveLength(1); expect(b.get).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).not.toContain("Synthetic.prj"); expect(choose()).toBeEnabled();
  fireEvent.click(choose()); fireEvent.click(choose()); await flush();
  expect(b.openings()).toHaveLength(2);
});
it("technical initial-data failure never starts a project dialog", async () => {
  const b = binding(); b.getInitial.mockRejectedValue(new Error("technical failure"));
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(b.call).not.toHaveBeenCalled(); expect(b.openings()).toHaveLength(0);
});
it("preserves the technical 15-second initial-data timeout and ignores its late required snapshot", async () => {
  const initial = deferred(); const b = binding(initial.promise);
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(15001); });
  expect(document.body.textContent).toMatch(/n’a pas répondu à temps/);
  await act(async () => initial.resolve(snapshot())); await flush();
  expect(b.call).not.toHaveBeenCalled();
});
it("failed work.get or error snapshot never triggers automatic selection", async () => {
  const b = binding(snapshot(), { ok: false, error: { code: "technical_error", message: "Work unavailable" } });
  const view = render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(b.openings()).toHaveLength(0); fireEvent.click(choose()); await flush(); expect(b.openings()).toHaveLength(0);
  view.unmount();
  const error = binding(snapshot("error"), current(work(snapshot("error"))));
  render(<AimEditor hostEnabled={false} limitedHost />); await flush(); expect(error.openings()).toHaveLength(0);
});
it.each(["explicit", "accepted history"])("%s project is adopted without automatic dialog", async () => {
  const b = binding(snapshot("accepted"), current(work(snapshot("accepted"))));
  render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(b.get).toHaveBeenCalledTimes(1); expect(b.openings()).toHaveLength(0);
  expect(document.body.textContent).toContain("Synthetic.prj");
});
it("obsolete work.get after generation change cannot adopt or start selection", async () => {
  const old = deferred(); const b = binding(snapshot(), old.promise);
  const view = render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  view.rerender(<AimEditor hostEnabled={false} limitedHost={false} />); await flush();
  await act(async () => old.resolve(current(work(snapshot("accepted"))))); await flush();
  expect(b.openings()).toHaveLength(0); expect(document.body.textContent).not.toContain("Synthetic.prj");
});
it("obsolete transition cannot replace a new generation or clear its selection lock", async () => {
  const b = binding(); const view = render(<AimEditor hostEnabled={false} limitedHost />); await flush();
  view.rerender(<AimEditor hostEnabled={false} limitedHost={false} />); await flush();
  const newer = binding(); view.rerender(<AimEditor hostEnabled={false} limitedHost />); await flush();
  expect(newer.openings()).toHaveLength(1); expect(choose()).toBeDisabled();
  const next = work(snapshot("accepted"), 9);
  await act(async () => b.transition.resolve({ ok: true, status: "transitioned", work: next })); await flush();
  expect(newer.get).toHaveBeenCalledTimes(1); expect(choose()).toBeDisabled();
  expect(document.body.textContent).not.toContain("Synthetic.prj");
});
it("work.get response after unmount cannot start a dialog", async () => {
  const pending = deferred(); const b = binding(snapshot(), pending.promise);
  const view = render(<AimEditor hostEnabled={false} limitedHost />); await flush(); view.unmount();
  await act(async () => pending.resolve(current(work()))); await flush(); expect(b.openings()).toHaveLength(0);
});
it("transition response after unmount cannot adopt or request another work.get", async () => {
  const b = binding(); const view = render(<AimEditor hostEnabled={false} limitedHost />); await flush(); view.unmount();
  await act(async () => b.transition.resolve({ ok: true, status: "transitioned", work: work(snapshot("accepted")) })); await flush();
  expect(b.get).toHaveBeenCalledTimes(1); expect(b.openings()).toHaveLength(1);
});