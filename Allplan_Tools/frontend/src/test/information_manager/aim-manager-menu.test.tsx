import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import examples from "../fixtures/aim-complete/backend-examples.json";
import { ProjectManager } from "@/modules/information_manager/components/project-manager";
import { callManagerMenu, managerMenuAvailable, parseManagerMenu } from "@/modules/information_manager/lib/aim-manager-menu-contract";
import { presentationCanUpdate } from "@/modules/information_manager/lib/aim-presentation-contract";
import { parseManager } from "@/modules/information_manager/lib/aim-manager-contract";

const identity = { ...examples.identityCompatibleFutureFrontend, project_manager_menu_contract: 1 };
const verified = vi.hoisted(() => ({ info: undefined as unknown }));
vi.mock("@/shared/transport/native-binding", () => ({ getVerifiedAppInfo: () => verified.info }));
const wire = (c: string) => structuredClone(examples.calls.find((x) => x.command === c)?.response);
const path = "C:\\AIM-Synthetic\\Prj\\Synthetic.prj";
const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
beforeEach(() => { verified.info = identity; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function host() {
  let paths: string[] = [];
  let removed = false;
  let failure: string | null = null;
  const call = vi.fn(async (command: string, payload: Record<string, unknown>): Promise<unknown> => {
    if (command === "project.manager.list") {
      const raw = wire(command) as { ok: true; projects: { path: string }[] };
      if (removed) raw.projects = raw.projects.filter((p) => p.path !== path);
      return raw;
    }
    if (command === "project.manager.favorites.list") return failure === "list"
      ? { ok: false, error: { code: "manager_unavailable", message: "Favoris indisponibles." } }
      : { ok: true, paths };
    if (command === "project.manager.favorite.set") {
      if (failure) return { ok: false, error: { code: "manager_unavailable", message: "Enregistrement impossible." } };
      paths = payload["favorite"] ? [path] : [];
      return { ok: true, status: "updated", path, favorite: payload["favorite"] };
    }
    if (command === "project.manager.folder.open") return failure
      ? { ok: false, error: { code: failure, message: "Dossier de projet introuvable." } }
      : { ok: true, status: "opened", path };
    if (command === "project.manager.remove") {
      if (failure) return { ok: false, error: { code: "manager_unavailable", message: "Retrait impossible." } };
      removed = true; paths = [];
      return { ok: true, status: "removed", path };
    }
    return wire(command);
  });
  vi.stubGlobal("pywebview", { api: { call } });
  return { call, fail: (code: string | null) => { failure = code; }, paths: () => paths };
}
const mount = async () => {
  const open = vi.fn(async () => {});
  const mounted = render(<ProjectManager onOpen={open} onClose={() => {}} />);
  await flush();
  return { ...mounted, open };
};
const star = () => screen.getByRole("button", { name: /mes favoris : Synthetic.prj/ });
const menu = async (label: string) => {
  fireEvent.keyDown(screen.getByRole("button", { name: "Actions pour Synthetic.prj" }), { key: "Enter" });
  await flush();
  fireEvent.click(screen.getByRole("menuitem", { name: label }));
  await flush();
};
it("requires integer menu marker 1 independently of manager and preserves update capabilities", () => {
  expect(managerMenuAvailable(identity)).toBe(true);
  expect(presentationCanUpdate(identity)).toBe(true);
  for (const marker of [undefined, true, false, 0, 2, 1.5, "1"])
    expect(managerMenuAvailable({ ...identity, project_manager_menu_contract: marker })).toBe(false);
  expect(managerMenuAvailable({ ...identity, project_manager_contract: undefined })).toBe(false);
  expect(managerMenuAvailable({ ...identity, capabilities: ["project.select", "project.manager.remove"] })).toBe(false);
});
it("old host leaves unsupported buttons disabled and sends no menu command", async () => {
  verified.info = examples.identityCompatibleFutureFrontend;
  const h = host(); await mount();
  expect(star()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" }));
  expect(h.call.mock.calls.map(([c]) => c)).toEqual(["project.manager.list"]);
  await expect(callManagerMenu("project.manager.remove", { path })).rejects.toThrow("manager_menu_unavailable");
  expect(h.call).toHaveBeenCalledTimes(1);
});
it("WorkV2 keeps the independent integer menu marker for favorite and list-only removal", async () => {
  const workV2 = { ...identity, read_only: false, working_state_contract: 2, project_save_contract: 1,
    project_save_capabilities: ["project.values.save", "project.values.save.status"] };
  expect(managerMenuAvailable(workV2)).toBe(true);
  for (const marker of [undefined, true, "1", 0, 2])
    expect(managerMenuAvailable({ ...workV2, project_manager_menu_contract: marker })).toBe(false);
  verified.info = workV2;
  const h = host();
  expect(await callManagerMenu("project.manager.favorite.set", { path, favorite: true })).toEqual({ kind: "updated", path, favorite: true });
  expect(await callManagerMenu("project.manager.favorites.list", {})).toEqual({ kind: "favorites", paths: [path] });
  expect(await callManagerMenu("project.manager.remove", { path })).toEqual({ kind: "removed", path });
  expect(h.call.mock.calls).toEqual([
    ["project.manager.favorite.set", { path, favorite: true }],
    ["project.manager.favorites.list", {}],
    ["project.manager.remove", { path }],
  ]);
});
it("strict payloads and success envelopes reject extra fields, wrong types and mismatched responses", async () => {
  const h = host();
  expect(await callManagerMenu("project.manager.favorite.set", { path, favorite: "true" })).toEqual({ kind: "invalid" });
  expect(await callManagerMenu("project.manager.remove", { path, delete: true })).toEqual({ kind: "invalid" });
  expect(await callManagerMenu("project.manager.favorites.list", { path })).toEqual({ kind: "invalid" });
  expect(h.call).not.toHaveBeenCalled();
  for (const raw of [{ ok: true, paths: [], extra: 1 }, { ok: true, paths: [true] }])
    expect(parseManagerMenu("project.manager.favorites.list", raw).kind).toBe("invalid");
  expect(parseManagerMenu("project.manager.favorite.set", { ok: true, status: "updated", path, favorite: 1 }).kind).toBe("invalid");
  expect(parseManagerMenu("project.manager.remove", { ok: true, status: "removed", path, favorite: false }).kind).toBe("invalid");
  expect(parseManager("project.manager.list", { ok: true, projects: [{ favorite: true }] }).kind).toBe("invalid");
  h.call.mockResolvedValueOnce({ ok: true, status: "removed", path: "C:\\Other.prj" });
  expect(await callManagerMenu("project.manager.remove", { path })).toEqual({ kind: "invalid" });
  h.call.mockResolvedValueOnce({ ok: true, status: "updated", path, favorite: false });
  expect(await callManagerMenu("project.manager.favorite.set", { path, favorite: true })).toEqual({ kind: "invalid" });
});
it("favorites list accepts empty host state and deduplicates Windows path identities", () => {
  expect(parseManagerMenu("project.manager.favorites.list", { ok: true, paths: [] })).toEqual({ kind: "favorites", paths: [] });
  const result = parseManagerMenu("project.manager.favorites.list", { ok: true, paths: [path, path.toUpperCase()] });
  expect(result.kind === "favorites" ? result.paths.length : 0).toBe(1);
});
it("favorite success reloads host lists and persists across manager remount; removal uses explicit false", async () => {
  const h = host(); const m = await mount();
  fireEvent.click(star()); await flush();
  expect(h.call).toHaveBeenCalledWith("project.manager.favorite.set", { path, favorite: true });
  expect(star()).toHaveAttribute("aria-pressed", "true");
  expect(h.call.mock.calls.slice(-2).map(([c]) => c)).toEqual(["project.manager.list", "project.manager.favorites.list"]);
  m.unmount(); await mount();
  expect(star()).toHaveAttribute("aria-pressed", "true");
  await menu("Retirer de mes favoris");
  expect(h.call).toHaveBeenCalledWith("project.manager.favorite.set", { path, favorite: false });
  expect(star()).toHaveAttribute("aria-pressed", "false");
});
it("favorite save error and favorites read error preserve confirmed star and rows", async () => {
  const h = host(); await mount(); fireEvent.click(star()); await flush();
  h.fail("save"); fireEvent.click(star()); await flush();
  expect(star()).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("Enregistrement impossible.");
  h.fail("list"); fireEvent.click(screen.getByRole("button", { name: "Actualiser la liste" })); await flush();
  expect(star()).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("Favoris indisponibles.");
});
it("opening Explorer sends only the listed path and does not open editor, preview or MRU", async () => {
  const h = host(); const m = await mount(); h.call.mockClear();
  await menu("Ouvrir le dossier du projet");
  expect(h.call.mock.calls).toEqual([["project.manager.folder.open", { path }], ["project.manager.list", {}], ["project.manager.favorites.list", {}]]);
  expect(m.open).not.toHaveBeenCalled();
});
it.each(["project_folder_unavailable", "unsupported_platform"])("folder refusal %s preserves confirmed state", async (code) => {
  const h = host(); await mount(); h.fail(code);
  await menu("Ouvrir le dossier du projet");
  expect(screen.getByRole("button", { name: "Synthetic.prj" })).toBeEnabled();
  expect(screen.getByRole("alert")).toHaveTextContent("Dossier de projet introuvable.");
  expect(h.call.mock.calls.filter(([c]) => c === "project.manager.list")).toHaveLength(1);
});
it("remove clears only selected preview and favorite, leaves active editor/MRU untouched", async () => {
  const h = host(); const m = await mount(); fireEvent.click(star()); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" })); await flush();
  expect(screen.getByRole("table")).toBeTruthy();
  h.call.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" })); await flush();
  expect(h.call.mock.calls).toEqual([["project.manager.remove", { path }], ["project.manager.list", {}], ["project.manager.favorites.list", {}]]);
  expect(screen.queryByRole("button", { name: "Synthetic.prj" })).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
  expect(m.open).not.toHaveBeenCalled();
  expect(h.paths()).toEqual([]);
});
it("failed removal keeps preview, project and favorite confirmed", async () => {
  const h = host(); await mount(); fireEvent.click(star()); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" })); await flush();
  h.fail("save");
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" })); await flush();
  expect(screen.getByRole("table")).toBeTruthy();
  expect(star()).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("Retrait impossible.");
});
it("opened editor path blocks both removal entries despite another preview selection and re-enables after close", async () => {
  const h = host();
  const open = vi.fn(async () => {});
  const m = render(<ProjectManager onOpen={open} onClose={() => {}} activePath="c:/aim-synthetic/prj/SYNTHETIC.PRJ/" />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Other.prj" })); await flush();
  h.call.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" }));
  await menu("Retirer de la liste…");
  expect(h.call.mock.calls.filter(([command]) => command === "project.manager.remove")).toEqual([]);
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" }); await flush();
  expect(screen.getByRole("button", { name: "Synthetic.prj" })).toBeTruthy();
  m.rerender(<ProjectManager onOpen={open} onClose={() => {}} activePath={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" })); await flush();
  expect(h.call).toHaveBeenCalledWith("project.manager.remove", { path });
  expect(screen.queryByRole("button", { name: "Synthetic.prj" })).toBeNull();
});
it("another open project does not prevent removing the selected preview entry", async () => {
  const h = host();
  render(<ProjectManager onOpen={async () => {}} onClose={() => {}} activePath="C:\\AIM-Synthetic\\Prj\\Other.prj" />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" })); await flush();
  h.call.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" })); await flush();
  expect(h.call).toHaveBeenCalledWith("project.manager.remove", { path });
  expect(screen.getByRole("button", { name: "Other.prj" })).toBeTruthy();
});
it("removing another entry preserves the selected preview", async () => {
  host(); await mount(); fireEvent.click(screen.getByRole("button", { name: "Other.prj" })); await flush();
  // Supplied preview is deliberately not for Other, so use the selected button as confirmed selection evidence.
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" })); await flush();
  expect(screen.getByRole("button", { name: "Other.prj" })).toHaveAttribute("aria-pressed", "true");
});
it("removal invalidates an in-flight preview and ignores its late result", async () => {
  const h = host(); let release: ((v: unknown) => void) | undefined;
  const original = h.call.getMockImplementation();
  h.call.mockImplementation(async (c, p) => c === "project.manager.preview"
    ? new Promise<unknown>((resolve) => { release = resolve; }) : original?.(c, p));
  await mount(); fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" })); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" })); await flush();
  release?.(wire("project.manager.preview")); await flush();
  expect(screen.queryByRole("table")).toBeNull();
});
it("pending favorite never changes star early and duplicate clicks dispatch only once", async () => {
  const h = host(); let release: ((v: unknown) => void) | undefined;
  h.call.mockImplementationOnce(async () => wire("project.manager.list"));
  await mount();
  h.call.mockImplementationOnce(async () => new Promise<unknown>((resolve) => { release = resolve; }));
  fireEvent.click(star()); fireEvent.click(star()); await flush();
  expect(star()).toHaveAttribute("aria-pressed", "false");
  expect(h.call.mock.calls.filter(([c]) => c === "project.manager.favorite.set")).toHaveLength(1);
  release?.({ ok: false, error: { code: "manager_unavailable", message: "Refus" } }); await flush();
  expect(star()).toBeEnabled();
});