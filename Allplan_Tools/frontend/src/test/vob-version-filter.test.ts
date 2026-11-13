import { beforeEach, expect, it, vi } from "vitest";
import { includeVobVersion, managerVobFiles } from "@/lib/vob-manager-filter";
import { acceptAddedVobFiles, acceptVobProject, applyVobResourceSettings, mergeVobFiles, useVobResources } from "@/lib/vob-resources";
import { applyVobDocument, vobListFiles, vobSwitch, vobPreview } from "@/lib/vob-bridge";
import { useVobEditor } from "@/lib/vob-editor";
import { useAppDialog } from "@/lib/app-dialog";
const file = (version: string) => ({ id: version, name: `vob_${version}.dat`, path: `C:/Allplan/${version}/ETC/vob.dat`, version, source: "ETC" });
beforeEach(() => { useVobResources.setState({ addedFiles: [], addedProjects: [], busy: false }); useVobEditor.getState().setFiles([]); useVobEditor.getState().load([], null); useAppDialog.setState({ queue: [] }); delete window.pywebview; });
it("includes 2022 but excludes 2021 in inventories", () => {
  mergeVobFiles([file("2021"), file("2022")]);
  expect(useVobEditor.getState().files).toEqual([file("2022")]);
});
it("rejects imported files tagged 2021", () => {
  expect(() => acceptAddedVobFiles([file("2021")])).toThrow(/2022/);
  expect(useVobResources.getState().addedFiles).toEqual([]);
});
it("rejects projects tagged 2021 without adding references", () => {
  expect(() => acceptVobProject({ project: { name: "old", path: "C:/Prj/old", version: "2021" }, files: [file("2021")] })).toThrow(/2022/);
  expect(useVobResources.getState().addedProjects).toEqual([]);
});
it("removes pre-2022 entries from restored settings", () => {
  applyVobResourceSettings({ addedFiles: [file("2021"), file("2022")], addedProjects: [{ name: "old", path: "C:/Prj/old", version: "2021" }] });
  expect(useVobResources.getState().addedFiles).toEqual([file("2022")]);
  expect(useVobResources.getState().addedProjects).toEqual([]);
});
it("does not load pre-2022 initial documents", () => {
  applyVobDocument({ file: file("2021"), rules: [] });
  expect(useVobEditor.getState().file).toBeNull();
});
it("never invents a current version for an old context; discovery still starts at 2022", async () => {
  const call = vi.fn(async () => ({ ok: true as const, data: { files: [] } })); window.pywebview = { api: { call } };
  await vobListFiles({ version: "2021", source: "ETC" });
  expect(call).toHaveBeenCalledWith("vob.files.list", { version: "", source: "ETC", allVersions: true, minVersion: 2022, projects: [] });
});
it("does not send open or preview for known pre-2022 files", async () => {
  useVobEditor.getState().setFiles([file("2021")]);
  const call = vi.fn(); window.pywebview = { api: { call } };
  expect(await vobSwitch(file("2021").path)).toBe(false);
  expect(await vobPreview(file("2021").path)).toBeNull();
  expect(call).not.toHaveBeenCalled();
});
it("keeps the active 2027 version alongside a 2022 filter", () => {
  expect(includeVobVersion("2027", "2022", file("2027"))).toBe(true);
  expect(includeVobVersion("2022", "2022", file("2027"))).toBe(true);
  expect(includeVobVersion("2026", "2022", file("2027"))).toBe(false);
});
it("retains an open file missing from inventory but allows search to hide it", () => {
  expect(managerVobFiles([file("2022")], file("2027"), "")).toEqual([file("2022"), file("2027")]);
  expect(managerVobFiles([file("2022")], file("2027"), "2022")).toEqual([file("2022")]);
});