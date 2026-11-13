import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import examples from "../fixtures/aim-complete/backend-examples.json";
import {
  isAnyConfiguration,
  isAnyPresentation,
  isPresentation,
  outsideAttributes,
  parseUpdate,
  presentationTreeAvailable,
} from "@/modules/information_manager/lib/aim-presentation-contract";
import {
  addTreeOccurrence,
  configurationRows,
  deleteTree,
  moveTree,
  type TreeConfiguration,
  type TreePresentation,
} from "@/modules/information_manager/lib/presentation-tree";
import {
  managerAvailable,
  parseManager,
} from "@/modules/information_manager/lib/aim-manager-contract";
import { TreePresentationView } from "@/modules/information_manager/components/tree-presentation";
import { ProjectManager } from "@/modules/information_manager/components/project-manager";

const wire = (command: string) => examples.calls.find((c) => c.command === command)?.response;
const configuration = (): TreeConfiguration => {
  const raw: unknown = structuredClone(examples.configurationV2);
  if (!isAnyConfiguration(raw) || raw.version !== 2) throw new Error("Invalid supplied V2 fixture");
  return raw;
};
const presentation = (): TreePresentation => {
  const o = parseUpdate(structuredClone(wire("presentation.update")));
  if (
    o.kind !== "updated" ||
    o.presentation.configuration.version !== 2 ||
    o.presentation.model.version !== 2
  )
    throw new Error("Invalid supplied updated V2 fixture");
  return o.presentation as TreePresentation;
};
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 15; i++) await Promise.resolve();
  });
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Copilot exact V2 contracts", () => {
  it("accepts supplied mixed configuration and updated model, preserves V1", () => {
    expect(isAnyConfiguration(examples.configurationV1)).toBe(true);
    expect(isAnyConfiguration(examples.configurationV2)).toBe(true);
    const p = presentation();
    expect(isAnyPresentation(p)).toBe(true);
    expect(isPresentation(p)).toBe(false);
    expect(configurationRows(p.configuration).map((r) => r.id)).toEqual([
      "row-a",
      "row-b",
      "row-c",
      "row-d",
      "row-e",
    ]);
  });
  it("requires exact markers independently of unchanged presentation capabilities", () => {
    const info = examples.identityCompatibleFutureFrontend;
    expect(presentationTreeAvailable(info)).toBe(true);
    expect(managerAvailable(info)).toBe(true);
    for (const marker of [undefined, 0, "1", 2]) {
      expect(presentationTreeAvailable({ ...info, presentation_tree_contract: marker })).toBe(
        false,
      );
      expect(managerAvailable({ ...info, project_manager_contract: marker })).toBe(false);
    }
  });
  it("rejects undeclared fields, duplicate IDs, reserved virtual categories and wrong mixed model order", () => {
    const c = configuration();
    const cat = c.categories[0];
    if (!cat) throw new Error("No category");
    cat.id = "all";
    expect(isAnyConfiguration(c)).toBe(false);
    const d = configuration();
    const first = d.categories[0]?.children[0];
    if (!first) throw new Error("No child");
    Object.assign(first, { value: "invented" });
    expect(isAnyConfiguration(d)).toBe(false);
    const p = presentation();
    p.model.categories[0]?.children.reverse();
    expect(isAnyPresentation(p)).toBe(false);
  });
});
describe("mixed parent movement and deletion", () => {
  it("counts direct and grouped occurrences and releases only the last removed number", () => {
    const c = configuration();
    expect(configurationRows(c)).toHaveLength(5);
    const available = [{ number: "7" }, { number: "8" }, { number: "9" }, { number: "10" }];
    expect(outsideAttributes(c, available)).toEqual([{ number: "10" }]);
    const one = deleteTree(c, "row", "row-a");
    expect(outsideAttributes(one, available)).toEqual([{ number: "10" }]);
    const last = deleteTree(one, "row", "row-b");
    expect(configurationRows(last)).toHaveLength(3);
    expect(outsideAttributes(last, available)).toEqual([{ number: "7" }, { number: "10" }]);
  });
  it("moves a grouped row directly into category head without a Sans groupe container", () => {
    const n = moveTree(configuration(), { kind: "row", id: "row-b", target: "category-b" });
    expect(n.categories[1]?.children.map((r) => r.id)).toEqual(["row-b"]);
    expect(configurationRows(n).filter((r) => r.id === "row-b")).toHaveLength(1);
  });
  it("moves direct row into group end and before a sibling with adopted parent", () => {
    const n = moveTree(configuration(), { kind: "row", id: "row-a", target: "group-a" });
    const g = n.categories[0]?.children.find((x) => x.id === "group-a");
    expect(g?.kind === "group" ? g.rows.map((r) => r.id) : []).toEqual(["row-b", "row-c", "row-a"]);
    const direct = moveTree(n, { kind: "row", id: "row-a", target: "category-a", before: "row-d" });
    expect(direct.categories[0]?.children.map((x) => x.id)).toEqual([
      "group-a",
      "row-a",
      "row-d",
      "group-b",
    ]);
  });
  it("moves group among mixed siblings without nesting and keeps child order", () => {
    const n = moveTree(configuration(), {
      kind: "group",
      id: "group-b",
      target: "category-a",
      before: "row-d",
    });
    expect(n.categories[0]?.children.map((x) => x.id)).toEqual([
      "row-a",
      "group-a",
      "group-b",
      "row-d",
    ]);
    expect(moveTree(n, { kind: "group", id: "group-a", target: "group-b" })).toBe(n);
  });
  it("deletes a group with its children, retaining direct siblings and repeat occurrences", () => {
    const n = deleteTree(configuration(), "group", "group-a");
    expect(configurationRows(n).map((r) => r.id)).toEqual(["row-a", "row-d", "row-e"]);
    expect(outsideAttributes(n, [{ number: "7" }, { number: "8" }, { number: "9" }])).toEqual([]);
  });
  it("deletes only one occurrence and deletes categories without transfer", () => {
    const n = deleteTree(configuration(), "row", "row-a");
    expect(
      configurationRows(n)
        .filter((r) => r.num === 7)
        .map((r) => r.id),
    ).toEqual(["row-b"]);
    const d = deleteTree(n, "category", "category-a");
    expect(d.categories.map((x) => x.id)).toEqual(["category-b"]);
    expect(configurationRows(d)).toEqual([]);
  });
  it("repeated addition creates independent IDs and virtual target is rejected", () => {
    const c = configuration();
    const a = addTreeOccurrence(c, "category-b", { number: "7", label: "Repeat" }, () => "new-a");
    if (!a) throw new Error("No add");
    const b = addTreeOccurrence(a, "category-b", { number: "7", label: "Repeat" }, () => "new-b");
    expect(
      b
        ? configurationRows(b)
            .filter((r) => r.num === 7)
            .map((r) => r.id)
        : [],
    ).toEqual(["row-a", "row-b", "new-a", "new-b"]);
    expect(moveTree(c, { kind: "row", id: "row-a", target: "unlisted" })).toBe(c);
  });
});
describe("mounted V2 and project manager", () => {
  it("mounted counters change with the received presentation and outside attributes", () => {
    const p = presentation();
    const { rerender } = render(<TreePresentationView presentation={p} outside={[]} />);
    expect(document.querySelector('[data-category-count="all"]')?.textContent).toBe("5");
    const next = presentation();
    next.configuration = deleteTree(next.configuration, "group", "group-a");
    const category = next.model.categories[0];
    if (!category) throw new Error("Missing synthetic category");
    category.children = category.children.filter((child) => child.id !== "group-a");
    rerender(<TreePresentationView presentation={next} outside={[{ number: "10", label: "Outside", value: "0", valueState: "set" }]} />);
    expect(document.querySelector('[data-category-count="all"]')?.textContent).toBe("3");
    expect(document.querySelector('[data-category-count="unlisted"]')?.textContent).toBe("1");
  });
  it("uses supplied versions only and cannot dispatch unsupported favorite, removal or folder commands", async () => {
    const call = vi.fn(async (command: string) => wire(command));
    vi.stubGlobal("pywebview", { api: { call } });
    render(<ProjectManager onOpen={async () => {}} onClose={() => {}} />); await flush();
    fireEvent.click(screen.getByRole("button", { name: /Ajoutés par l’utilisateur/ }));
    expect(screen.getByRole("button", { name: "Ajouter à mes favoris : Synthetic.prj" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Retirer de la liste : Synthetic.prj" }));
    expect(call.mock.calls.map(([command]) => command)).toEqual(["project.manager.list"]);
  });
  it("category view changes only after 600ms continuous row hover; cancellation changes no configuration", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    render(<TreePresentationView presentation={presentation()} onConfigurationChange={changed} />);
    const grip = document.querySelector('[data-row-id="row-a"] [draggable]');
    const cat = document.querySelector('[data-category-id="category-b"]');
    if (!grip || !cat) throw new Error("Missing drag elements");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "move" };
    fireEvent.dragStart(grip, { dataTransfer });
    fireEvent.dragEnter(cat, { dataTransfer });
    act(() => vi.advanceTimersByTime(599));
    expect(document.querySelector('[data-row-id="row-a"]')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(document.querySelector('[data-row-id="row-a"]')).toBeNull();
    fireEvent.dragEnd(grip);
    expect(changed).not.toHaveBeenCalled();
  });
  it("a late preview cannot replace a more recent project selection", async () => {
    let release: ((v: unknown) => void) | undefined;
    const first = new Promise<unknown>((resolve) => {
      release = resolve;
    });
    const call = vi.fn(async (command: string, payload: { path?: string }) => {
      if (command !== "project.manager.preview") return wire(command);
      if (payload.path?.endsWith("Synthetic.prj")) return first;
      const raw = structuredClone(wire(command)) as {
        preview: { project: { path: string; name: string } };
      };
      raw.preview.project = { path: payload.path ?? "", name: "Other.prj" };
      return raw;
    });
    vi.stubGlobal("pywebview", { api: { call } });
    render(<ProjectManager onOpen={async () => {}} onClose={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Ajoutés par l’utilisateur/ }));
    fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" }));
    fireEvent.click(screen.getByRole("button", { name: "Other.prj" }));
    await flush();
    release?.(wire("project.manager.preview"));
    await flush();
    expect(screen.getByLabelText("Aperçu du projet").textContent).toContain("Other.prj");
    expect(screen.getByLabelText("Aperçu du projet").textContent).not.toContain("Synthetic.prj");
  });
  it("mounted view retains mixed order and confirms destructive container counts without mutation on cancel", () => {
    const changed = vi.fn();
    render(<TreePresentationView presentation={presentation()} onConfigurationChange={changed} />);
    expect(
      [...document.querySelectorAll("[data-row-id], [data-group-id]")].map(
        (x) => x.getAttribute("data-row-id") ?? x.getAttribute("data-group-id"),
      ),
    ).toEqual(["row-a", "group-a", "row-b", "row-c", "row-d", "group-b", "row-e"]);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer group-a" }));
    expect(screen.getByRole("dialog").textContent).toContain("2 lignes");
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(changed).not.toHaveBeenCalled();
  });
  it("all supplied manager success and failure envelopes are consumed strictly", () => {
    expect(parseManager("project.manager.list", wire("project.manager.list")).kind).toBe("list");
    expect(parseManager("project.manager.preview", wire("project.manager.preview")).kind).toBe(
      "preview",
    );
    expect(parseManager("project.manager.open", wire("project.manager.open")).kind).toBe("opened");
    expect(parseManager("project.source", wire("project.source")).kind).toBe("source");
    expect(
      parseManager("project.manager.list", { ...wire("project.manager.list"), extra: true }).kind,
    ).toBe("invalid");
  });
  it("preview and reload never open project or add MRU, double click uses selected project", async () => {
    const call = vi.fn(async (command: string) => wire(command));
    vi.stubGlobal("pywebview", { api: { call } });
    const open = vi.fn(async () => {});
    render(<ProjectManager onOpen={open} onClose={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Ajoutés par l’utilisateur/ }));
    fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" }));
    await flush();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").length).toBeGreaterThan(2);
    expect(table.textContent).toContain("0");
    expect(table.textContent).toContain("false");
    fireEvent.click(screen.getByRole("button", { name: "Actualiser l’aperçu" }));
    await flush();
    expect(call.mock.calls.map(([c]) => c)).toEqual([
      "project.manager.list",
      "project.manager.preview",
      "project.manager.preview",
    ]);
    expect(open).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByLabelText("Aperçu du projet"));
    expect(open).toHaveBeenCalledWith("C:\\AIM-Synthetic\\Prj\\Synthetic.prj");
  });
  it("failed reload invalidates preview without opening the active editor", async () => {
    let fail = false;
    const call = vi.fn(async (command: string) =>
      command === "project.manager.preview" && fail
        ? { ok: false, error: { code: "project_read_error", message: "Source indisponible" } }
        : wire(command),
    );
    vi.stubGlobal("pywebview", { api: { call } });
    const open = vi.fn(async () => {});
    render(<ProjectManager onOpen={open} onClose={() => {}} />);
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /Ajoutés par l’utilisateur/ }));
    fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" }));
    await flush();
    expect(screen.getByRole("table")).toBeTruthy();
    fail = true;
    fireEvent.click(screen.getByRole("button", { name: "Actualiser l’aperçu" }));
    await flush();
    expect(screen.queryByRole("table")).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
