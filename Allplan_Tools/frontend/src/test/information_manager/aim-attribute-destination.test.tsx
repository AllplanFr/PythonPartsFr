import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LangContext, DICTS } from "@/modules/information_manager/lib/i18n";
import { PresentationAttributeForm } from "@/modules/information_manager/components/presentation-attribute-form";
import { OrganizedPresentationView } from "@/modules/information_manager/components/organized-presentation";
import { TreePresentationView } from "@/modules/information_manager/components/tree-presentation";
import { isPresentation } from "@/modules/information_manager/lib/aim-presentation-contract";
import type { TreePresentation } from "@/modules/information_manager/lib/presentation-tree";
import fixture from "./synthetic-presentation.json";

afterEach(cleanup);
const GROUP = "3f2a9c1e-7b4d-4e2a-9abc-123456789abc";
const OTHER = "4f2a9c1e-7b4d-4e2a-9abc-123456789abc";
function sample() {
  const p: unknown = structuredClone(fixture.presentation);
  if (!isPresentation(p)) throw Error("Invalid synthetic fixture");
  for (const c of [p.configuration.categories[0], p.model.categories[0]]) {
    const g = c?.groups[0];
    if (!g) throw Error("Missing synthetic group");
    g.id = GROUP;
    c?.groups.push({ ...g, id: OTHER, position: 2, title: "Other group", rows: [] });
  }
  return p;
}
function treeSample(direct = false): TreePresentation {
  const p = sample();
  const categories: TreePresentation["configuration"]["categories"] = p.configuration.categories.map(({ groups, ...c }) => ({ ...c, children: groups.map(g => ({ ...g, kind: "group" as const, rows: g.rows.map(r => ({ ...r, kind: "row" as const })) })) }));
  const modelCategories: TreePresentation["model"]["categories"] = p.model.categories.map(({ groups, ...c }) => ({ ...c, children: groups.map(g => ({ ...g, kind: "group" as const, rows: g.rows.map(r => ({ ...r, kind: "row" as const })) })) }));
  if (direct) {
    for (const cats of [categories, modelCategories]) {
      const c = cats[0], g = c?.children[0];
      if (!c || !g || g.kind !== "group") throw Error("Missing group");
      const rows = g.rows.splice(0, 2);
      // Both trees retain their own row type; the union above is only for fixture setup.
      (c.children as unknown as { position: number }[]).splice(0, 0, ...rows);
      c.children.forEach((r, i) => { r.position = i + 1; });
      g.rows.forEach((r, i) => { r.position = i + 1; });
    }
  }
  return { configuration: { ...p.configuration, version: 2, categories }, model: { ...p.model, version: 2, categories: modelCategories }, report: null };
}
it.each([false, true])("preserves the full existing group ID on form submit (editing=%s)", editing => {
  const apply = vi.fn();
  render(<LangContext.Provider value={DICTS.fr}><PresentationAttributeForm heading="Attribute" attributes={[{ num: 7, name: "Native label" }]} {...(editing ? { initial: { num: 7, name: "Native label", title: "Original", widget: "entry" as const, type: "STR" as const, value: "0", group: GROUP } } : {})} used={[]} groups={[GROUP]} groupLabels={{ [GROUP]: "Synthetic group" }} cats={[{ id: "cat", name: "Category" }]} groupCat={{ [GROUP]: "cat" }} defaultCat="cat" onSubmit={apply} onCancel={() => {}} /></LangContext.Provider>);
  if (!editing) {
    fireEvent.change(screen.getByRole("combobox", { name: DICTS.fr.fAttr }), { target: { value: "7" } });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Catégorie / Groupe" }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Category / Synthetic group" }));
  }
  fireEvent.submit(screen.getByRole("form"));
  expect(apply.mock.calls[0]?.[0].group).toBe(GROUP);
  expect(apply.mock.calls[0]?.[1]).toBe("cat");
});
it.each([1, 2])("title-only editing preserves group UUID and every sibling position in V%s", version => {
  const p = version === 1 ? sample() : treeSample();
  const source = structuredClone(p), change = vi.fn();
  render(<LangContext.Provider value={DICTS.fr}>{p.configuration.version === 1 ? <OrganizedPresentationView presentation={p as ReturnType<typeof sample>} onConfigurationChange={change} /> : <TreePresentationView presentation={p as TreePresentation} onConfigurationChange={change} />}</LangContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Éditer synthetic-row-2" }));
  fireEvent.change(screen.getByPlaceholderText(DICTS.fr.fTitlePh), { target: { value: "Renamed" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  const expected = structuredClone(source.configuration);
  const c = expected.categories[0];
  const g = c && ("groups" in c ? c.groups[0] : c.children.find(x => x.kind === "group"));
  const r = g && "rows" in g ? g.rows[1] : undefined;
  if (!r) throw Error("Missing row");
  r.title = "Renamed";
  expect(change.mock.calls[0]?.[0]).toEqual(expected);
  expect(p).toEqual(source);
});
it("editing a direct category row preserves its mixed sibling position", () => {
  const p = treeSample(true), source = structuredClone(p), change = vi.fn();
  render(<LangContext.Provider value={DICTS.fr}><TreePresentationView presentation={p} onConfigurationChange={change} /></LangContext.Provider>);
  fireEvent.click(screen.getByRole("button", { name: "Éditer synthetic-row-2" }));
  fireEvent.change(screen.getByPlaceholderText(DICTS.fr.fTitlePh), { target: { value: "Renamed direct" } });
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
  const expected = structuredClone(p.configuration);
  const row = expected.categories[0]?.children[1];
  if (!row || row.kind !== "row") throw Error("Missing direct row");
  row.title = "Renamed direct";
  expect(change.mock.calls[0]?.[0]).toEqual(expected);
  expect(p).toEqual(source);
});