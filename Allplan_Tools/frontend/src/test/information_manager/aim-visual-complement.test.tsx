import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import examples from "../fixtures/aim-complete/backend-examples.json";
import fixture from "./synthetic-presentation.json";
import { isPresentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import { OrganizedPresentationView } from "@/modules/information_manager/components/organized-presentation";
import { TreePresentationView } from "@/modules/information_manager/components/tree-presentation";
import { ProjectManager } from "@/modules/information_manager/components/project-manager";
import { parseUpdate } from "@/modules/information_manager/lib/aim-presentation-contract";
import type { TreePresentation } from "@/modules/information_manager/lib/presentation-tree";

const verified = vi.hoisted(() => ({ info: undefined as unknown }));
vi.mock("@/shared/transport/native-binding", () => ({ getVerifiedAppInfo: () => verified.info }));
const wire = (c: string) => structuredClone(examples.calls.find((x) => x.command === c)?.response) as Record<string, any>;
const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
beforeEach(() => { localStorage.clear(); localStorage.setItem("information_manager:lang", "fr"); verified.info = examples.identityCompatibleFutureFrontend; globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const listWith = (projects: { path: string; name: string; version: string }[]) => {
  return { ok: true, projects: projects.map((p) => ({ path: p.path, name: p.name,
    source: { status: "resolved", version: p.version, verificationVersion: false, reason: null }, sourceFreshness: "last_read", projectInstallation: {status:"associated",version:p.version,verificationVersion:false,prjPath:`C:\\Allplan ${p.version}\\PRJ`} })) };
};
const mount = async (list: unknown) => {
  verified.info = { ...examples.identityCompatibleFutureFrontend, project_manager_assignment_contract: 1 };
  vi.stubGlobal("pywebview", { api: { call: vi.fn(async (c: string) => (c === "project.manager.list" ? list : wire(c))) } });
  render(<ProjectManager onOpen={async () => {}} onClose={() => {}} />);
  await flush();
};
const header = (label: RegExp) => screen.getByRole("button", { name: label });

it("user and version sections contain disjoint projects classified by installation", async () => {
  await mount(listWith([{ path: "C:\\S\\A.prj", name: "A.prj", version: "2025" }, { path: "C:\\S\\B.prj", name: "B.prj", version: "2026" }]));
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(header(/Allplan 2025/)).toHaveTextContent("(1)");
  expect(document.querySelectorAll("[data-project-path]")).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "A.prj" })).toHaveLength(1);
  fireEvent.click(header(/Allplan 2025/));
  expect(header(/Allplan 2025/)).toHaveTextContent("(1)");
  expect(screen.queryByRole("button", { name: "A.prj" })).toBeNull();
  fireEvent.click(header(/Ajoutés par l’utilisateur/));
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(screen.queryByRole("button", { name: "A.prj" })).toBeNull();
});
it("search filter updates section counts consistently with children", async () => {
  await mount(listWith([{ path: "C:\\S\\A.prj", name: "A.prj", version: "2025" }, { path: "C:\\S\\B.prj", name: "B.prj", version: "2026" }]));
  fireEvent.change(screen.getByLabelText("Rechercher un projet"), { target: { value: "B.prj" } });
  expect(screen.queryByRole("button", { name: /Allplan 2025/ })).toBeNull();
  expect(header(/Allplan 2026/)).toHaveTextContent("(1)");
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(screen.getAllByRole("button", { name: "B.prj" })).toHaveLength(1);
});
it("version filter applies before exclusive classification without changing host entries or freshness", async () => {
  const list = listWith([{ path: "C:\\S\\A.prj", name: "A.prj", version: "2025" }, { path: "C:\\S\\B.prj", name: "B.prj", version: "2026" }]);
  const original = structuredClone(list);
  await mount(list);
  fireEvent.change(screen.getByLabelText("Version Allplan"), { target: { value: "2026" } });
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(header(/Allplan 2026/)).toHaveTextContent("(1)");
  expect(screen.queryByRole("button", { name: "A.prj" })).toBeNull();
  expect(screen.getAllByRole("button", { name: "B.prj" })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Rechercher un projet"), { target: { value: "A.prj" } });
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(document.querySelectorAll("[data-project-path]")).toHaveLength(0);
  expect(list).toEqual(original);
});
it("unknown assignment appears once in user section regardless of unresolved definitions", async () => {
  const project = { path: "C:\\S\\Unresolved.prj", name: "Unresolved.prj", source: { status: "unresolved", version: null, verificationVersion: null, reason: "definitions_not_loaded" }, sourceFreshness: "last_read", projectInstallation:{status:"unknown",reason:"legacy_entry"} };
  await mount({ ok: true, projects: [project] });
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(1)");
  expect(screen.queryByRole("button", {name:/Version non résolue/})).toBeNull();
  expect(screen.getAllByRole("button", { name: "Unresolved.prj" })).toHaveLength(1);
});
it("Copilot Synthetic.prj example is added, reread and removed from its unique section with the same host identity", async () => {
  verified.info = { ...examples.identityCompatibleFutureFrontend, project_manager_menu_contract: 1, project_manager_assignment_contract: 1 };
  const path = "C:\\AIM-Synthetic\\Prj\\Synthetic.prj";
  const project = listWith([{ path, name: "Synthetic.prj", version: "2026" }]).projects[0];
  let projects: unknown[] = [];
  let favorite = false;
  const call = vi.fn(async (command: string, payload: unknown) => {
    if (command === "project.manager.list") return { ok: true, projects: structuredClone(projects) };
    if (command === "project.manager.favorites.list") return { ok: true, paths: favorite ? [path] : [] };
    if (command === "project.manager.add") { projects = [project]; return { ok: true, status: "added", project }; }
    if (command === "project.manager.remove") { expect(payload).toEqual({ path }); projects = []; return { ok: true, status: "removed", path }; }
    if (command === "project.manager.favorite.set") { favorite = true; return { ok: true, status: "updated", path, favorite: true }; }
    return wire(command);
  });
  vi.stubGlobal("pywebview", { api: { call } });
  const renderManager = () => render(<ProjectManager onOpen={async () => {}} onClose={() => {}} />);
  renderManager(); await flush();
  fireEvent.click(screen.getByRole("button", { name: "Ajouter des projets" })); await flush();
  expect(call).toHaveBeenCalledWith("project.manager.add", {});
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(header(/Allplan 2026/)).toHaveTextContent("(1)");
  expect(new Set(Array.from(document.querySelectorAll("[data-project-path]"), (e) => e.getAttribute("data-project-path"))).size).toBe(1);
  cleanup(); renderManager(); await flush();
  expect(screen.getAllByRole("button", { name: "Synthetic.prj" })).toHaveLength(1);
  expect(projects).toEqual([project]);
  const star = screen.getAllByRole("button", { name: "Ajouter à mes favoris : Synthetic.prj" })[0];
  if (!star) throw new Error("Missing favorite action");
  fireEvent.click(star); await flush();
  expect(call).toHaveBeenCalledWith("project.manager.favorite.set", { path, favorite: true });
  expect(screen.getAllByRole("button", { name: "Retirer de mes favoris : Synthetic.prj" }).map((e) => e.getAttribute("aria-pressed"))).toEqual(["true"]);
  const removal = screen.getAllByRole("button", { name: "Retirer de la liste : Synthetic.prj" })[0];
  if (!removal) throw new Error("Missing project view");
  fireEvent.click(removal); await flush();
  expect(header(/Ajoutés par l’utilisateur/)).toHaveTextContent("(0)");
  expect(screen.queryByRole("button", { name: /Allplan 2026/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Synthetic.prj" })).toBeNull();
  cleanup(); renderManager(); await flush();
  expect(document.querySelectorAll("[data-project-path]")).toHaveLength(0);
  expect(call.mock.calls.every(([c]) => c.startsWith("project.manager."))).toBe(true);
});
it("preview heading has no close cross, keeps refresh", async () => {
  await mount({ok:true,projects:[]});
  expect(screen.queryByRole("button", { name: "Fermer le gestionnaire" })).toBeNull();
  expect(screen.getByRole("button", { name: /Actualiser l’aperçu/ })).toBeInTheDocument();
});

function sample() {
  const raw: unknown = structuredClone(fixture.presentation);
  if (!isPresentation(raw)) throw new Error("fixture");
  return raw;
}
it("category pencil tooltips say Renommer la catégorie", () => {
  render(<OrganizedPresentationView presentation={sample()} />);
  expect(document.querySelectorAll('[title="Renommer la catégorie"]').length).toBeGreaterThan(0);
  expect(document.querySelector('[title="Renommer le groupe"][aria-label^="Catégorie"]')).toBeNull();
  cleanup();
  const o = parseUpdate(wire("presentation.update"));
  if (o.kind !== "updated") throw new Error("fixture");
  render(<TreePresentationView presentation={o.presentation as TreePresentation} onConfigurationChange={() => {}} />);
  expect(document.querySelectorAll('[title="Renommer la catégorie"]').length).toBeGreaterThan(0);
});
it("drag shows a distinct non-interactive ghost of the moved row, removed on drop/cancel, no config copy", () => {
  vi.useFakeTimers();
  const p = sample(); const changes = vi.fn();
  render(<OrganizedPresentationView presentation={p} onConfigurationChange={changes} />);
  const setDragImage = vi.fn();
  const dataTransfer = { setData: vi.fn(), setDragImage, effectAllowed: "move" };
  const grip = document.querySelector('[data-row-id="synthetic-row-3"] [draggable]') as HTMLElement;
  fireEvent.dragStart(grip, { dataTransfer });
  const ghost = document.querySelector("[data-aim-drag-ghost]") as HTMLElement;
  expect(ghost).toBeTruthy();
  expect(ghost.dataset["aimDragGhost"]).toBe("row");
  expect(ghost.getAttribute("aria-hidden")).toBe("true");
  expect(ghost.textContent).toContain(p.model.categories[0]!.groups[0]!.rows.find((r) => r.id === "synthetic-row-3")!.title);
  expect(setDragImage).toHaveBeenCalledWith(ghost, expect.any(Number), expect.any(Number));
  expect(changes).not.toHaveBeenCalled();
  fireEvent.dragEnd(grip, { dataTransfer });
  expect(document.querySelector("[data-aim-drag-ghost]")).toBeNull();
  const group = document.querySelector('[data-group-id] [draggable]') as HTMLElement;
  fireEvent.dragStart(group, { dataTransfer });
  expect(document.querySelector('[data-aim-drag-ghost="group"]')).toBeTruthy();
  vi.runAllTimers();
  expect(document.querySelector("[data-aim-drag-ghost]")).toBeNull();
  fireEvent.dragEnd(group, { dataTransfer });
  expect(changes).not.toHaveBeenCalled();
});
