import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import examples from "../fixtures/aim-complete/backend-examples.json";
import { ProjectManager } from "@/modules/information_manager/components/project-manager";
import { parseManager, previewColorAvailable } from "@/modules/information_manager/lib/aim-manager-contract";

const base = examples.identityCompatibleFutureFrontend;
const colored = { ...base, project_manager_preview_color_contract: 1 };
const verified = vi.hoisted(() => ({ info: undefined as unknown }));
vi.mock("@/shared/transport/native-binding", () => ({ getVerifiedAppInfo: () => verified.info }));
const wire = (c: string) => structuredClone(examples.calls.find((x) => x.command === c)?.response) as Record<string, any>;
const flush = async () => { await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
const withColors = (a: unknown, b: unknown) => {
  const raw = wire("project.manager.preview");
  raw["preview"].items[1].backgroundColor = a;
  raw["preview"].items[2].backgroundColor = b;
  return raw;
};
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
beforeEach(() => { verified.info = colored; });

function host(responses: unknown[]) {
  const call = vi.fn(async (c: string) => (c === "project.manager.preview" ? responses.shift() : wire(c)));
  vi.stubGlobal("pywebview", { api: { call } });
  return call;
}
const openPreview = async () => {
  render(<ProjectManager onOpen={async () => {}} onClose={() => {}} />);
  await flush();
  fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" }));
  await flush();
};
const groupRow = (title: string) => screen.getByText(title).closest("tr") as HTMLElement;

it("marker must be the integer 1", () => {
  expect(previewColorAvailable(colored)).toBe(true);
  for (const m of [undefined, true, "1", 0, 2, 1.5, null])
    expect(previewColorAvailable({ ...base, project_manager_preview_color_contract: m })).toBe(false);
});
it("with marker, exact received colour is kept (case preserved, #a0C0e0)", () => {
  const o = parseManager("project.manager.preview", withColors("#a0C0e0", "#FF0000"), { previewColor: true });
  expect(o.kind).toBe("preview");
  if (o.kind === "preview") {
    expect((o.preview.items[1] as { backgroundColor: string }).backgroundColor).toBe("#a0C0e0");
    expect((o.preview.items[2] as { backgroundColor: string }).backgroundColor).toBe("#FF0000");
  }
});
it("with marker, absent, null or invalid colours are incompatible", () => {
  expect(parseManager("project.manager.preview", wire("project.manager.preview"), { previewColor: true }).kind).toBe("invalid");
  for (const bad of [null, "", "a0c0e0", "#abc", "#a0c0e0ff", "#GGGGGG", " #a0c0e0", 0xa0c0e0, "rgb(1,2,3)"])
    expect(parseManager("project.manager.preview", withColors("#a0C0e0", bad), { previewColor: true }).kind).toBe("invalid");
});
it("without marker, old four-field validator stays strict", () => {
  expect(parseManager("project.manager.preview", wire("project.manager.preview")).kind).toBe("preview");
  expect(parseManager("project.manager.preview", withColors("#a0C0e0", "#FF0000")).kind).toBe("invalid");
});
it("renders exact colour via --aim-group-accent", async () => {
  host([withColors("#a0C0e0", "#FF0000")]);
  await openPreview();
  expect(groupRow("Synthetic group").style.getPropertyValue("--aim-group-accent")).toBe("#a0C0e0");
  expect(groupRow("Second group").style.getPropertyValue("--aim-group-accent")).toBe("#FF0000");
});
it("old host renders neutral groups and no colour", async () => {
  verified.info = base;
  host([wire("project.manager.preview")]);
  await openPreview();
  expect(groupRow("Synthetic group").style.getPropertyValue("--aim-group-accent")).toBe("");
});
it("incompatible coloured response shows no partial preview", async () => {
  host([withColors("#a0C0e0", null)]);
  await openPreview();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByText("Aperçu indisponible.")).toBeInTheDocument();
});
it("attributes_without_presentation stays rows only, no borrowed colour", async () => {
  const raw = wire("project.manager.preview");
  raw["preview"].mode = "attributes_without_presentation";
  raw["preview"].items = [raw["preview"].items[0]];
  host([raw]);
  await openPreview();
  expect(document.querySelector(".aim-manager-preview .aim-organized-group")).toBeNull();
  expect(document.querySelector("[style*='--aim-group-accent']")).toBeNull();
});
it("reload leaves no residual colour", async () => {
  const neutral = withColors("#FFFFFF", "#FFFFFF");
  host([withColors("#a0C0e0", "#FF0000"), neutral]);
  await openPreview();
  expect(groupRow("Synthetic group").style.getPropertyValue("--aim-group-accent")).toBe("#a0C0e0");
  fireEvent.click(screen.getByRole("button", { name: "Synthetic.prj" }));
  await flush();
  expect(groupRow("Synthetic group").style.getPropertyValue("--aim-group-accent")).toBe("#FFFFFF");
  expect(groupRow("Second group").style.getPropertyValue("--aim-group-accent")).toBe("#FFFFFF");
});
