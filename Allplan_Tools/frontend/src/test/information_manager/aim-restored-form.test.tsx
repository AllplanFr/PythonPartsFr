import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LangContext, DICTS } from "@/modules/information_manager/lib/i18n";
import { PresentationAttributeForm } from "@/modules/information_manager/components/presentation-attribute-form";
import { TreePresentationView } from "@/modules/information_manager/components/tree-presentation";
import { ProjectManager } from "@/modules/information_manager/components/project-manager";
import { parseUpdate } from "@/modules/information_manager/lib/aim-presentation-contract";
import type { TreePresentation } from "@/modules/information_manager/lib/presentation-tree";
import examples from "../fixtures/aim-complete/backend-examples.json";

vi.mock("@/shared/transport/native-binding", () => ({ getVerifiedAppInfo: () => examples.identityCompatibleFutureFrontend }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
const sample = () => {
  const o = parseUpdate(structuredClone(examples.calls.find(c => c.command === "presentation.update")?.response));
  if (o.kind !== "updated") throw new Error("Missing supplied fixture");
  return o.presentation as TreePresentation;
};
const mountForm = () => {
  const apply = vi.fn(), cancel = vi.fn();
  render(<LangContext.Provider value={DICTS.fr}><PresentationAttributeForm heading="Éditer l’attribut" initial={{ num: 7, name: "Native label", title: "Original", widget: "entry", type: "STR", value: "001, untouched" }} attributes={[{ num: 7, name: "Native label" }]} used={[]} groups={[]} cats={[{ id: "cat", name: "Category" }]} groupCat={{}} defaultCat="cat" onSubmit={apply} onCancel={cancel} /></LangContext.Provider>);
  return { apply, cancel };
};
it("presentation type changes keep the exact native value rather than converting or resetting it", () => {
  const { apply } = mountForm();
  fireEvent.click(screen.getByRole("button", { name: "Entier" }));
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(apply).toHaveBeenCalledTimes(1);
  expect(apply.mock.calls[0]?.[0].value).toBe("001, untouched");
});
it("empty lists block apply and multiple proposals are added with Ctrl Enter", () => {
  const { apply } = mountForm();
  fireEvent.click(screen.getByRole("button", { name: "Liste sans saisie" }));
  expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  const bulk = screen.getByPlaceholderText(/Collez ou tapez plusieurs propositions/);
  fireEvent.change(bulk, { target: { value: "Alpha;Beta,Gamma\nDelta" } });
  fireEvent.keyDown(bulk, { key: "Enter", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  expect(apply.mock.calls[0]?.[0].options).toEqual(["Alpha", "Beta", "Gamma", "Delta"]);
});
it("cancel emits no mutation and keeps source unchanged", () => {
  const { apply, cancel } = mountForm();
  fireEvent.click(screen.getByRole("button", { name: "Case à cocher" }));
  fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
  expect(cancel).toHaveBeenCalledOnce(); expect(apply).not.toHaveBeenCalled();
});
it("inline category Escape cancels, Enter updates only configuration and preserves occurrence identities", () => {
  const p = sample(), source = structuredClone(p), change = vi.fn();
  render(<TreePresentationView presentation={p} onConfigurationChange={change} />);
  const name = p.configuration.categories[0]?.name;
  if (!name) throw new Error("Missing category");
  fireEvent.click(screen.getByRole("button", { name: `Éditer ${name}` }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nom de la catégorie" }), { target: { value: "Cancelled" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Nom de la catégorie" }), { key: "Escape" });
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: `Éditer ${name}` }));
  fireEvent.change(screen.getByRole("textbox", { name: "Nom de la catégorie" }), { target: { value: "Renamed" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Nom de la catégorie" }), { key: "Enter" });
  expect(change.mock.calls[0]?.[0].categories[0].name).toBe("Renamed");
  expect(change.mock.calls[0]?.[0].categories[0].children).toEqual(source.configuration.categories[0]?.children);
  expect(p).toEqual(source);
});
it("mounted occurrence form emits configuration only and never alters repeated native values", () => {
  const p = sample(), source = structuredClone(p.model), change = vi.fn();
  render(<LangContext.Provider value={DICTS.fr}><TreePresentationView presentation={p} attributes={[{ number: "7", label: "Synthetic attribute" }]} onConfigurationChange={change} /></LangContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Éditer row-a" }));
  fireEvent.change(screen.getByPlaceholderText(DICTS.fr.fTitlePh), { target: { value: "Memory title" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  const next = change.mock.calls[0]?.[0];
  expect(next.categories[0].children[0].id).toBe("row-a");
  expect(next.categories[0].children[0].title).toBe("Memory title");
  expect(next.categories[0].children[0]).not.toHaveProperty("value");
  expect(p.model).toEqual(source);
});
it("manager selects active host-listed path on opening and right click uses existing menu without business dispatch", async () => {
  const raw = structuredClone(examples.calls.find(c => c.command === "project.manager.list")?.response) as { projects: { path: string; name: string }[] };
  const active = raw.projects[0]; if (!active) throw new Error("Missing project");
  const call = vi.fn(async (c: string) => structuredClone(examples.calls.find(x => x.command === c)?.response));
  vi.stubGlobal("pywebview", { api: { call } });
  render(<ProjectManager activePath={active.path} onOpen={async () => {}} onClose={() => {}} />); await flush();
  expect(call).not.toHaveBeenCalledWith("project.manager.preview", { path: active.path });
  expect(screen.getAllByRole("button", { name: active.name })[0]).toHaveAttribute("aria-pressed", "true");
  const count = call.mock.calls.length;
  fireEvent.contextMenu(document.querySelector(`[data-project-path]`) as Element); await flush();
  expect(screen.getByRole("menuitem", { name: "Ouvrir dans l’éditeur" })).toBeTruthy();
  expect(call.mock.calls).toHaveLength(count);
});