import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyVobDocument, vobSwitch, vobListFiles, vobListBackups, vobRestoreBackup, vobAddFiles, vobAddProject } from "@/lib/vob-bridge";
import { collectSettings, applySettings } from "@/lib/app-settings";
import { vobDroppedPaths } from "@/lib/vob-file-drop";
import { useVobEditor, vobHasChanges } from "@/lib/vob-editor";
import { clearVobSessions, useVobResources, isAllplanVobFile } from "@/lib/vob-resources";
import { useAppDialog } from "@/lib/app-dialog";

const document = (path: string) => ({ file: { id: path, name: path, path }, rules: [{ trade: "12", object: "62", unit: "1", method: "02", formula: "A", comment: path }] });
beforeEach(() => { clearVobSessions(); useVobResources.setState({ busy: false, backups: [], backupFile: null, addedFiles: [], addedProjects: [], favorites: [] }); useVobEditor.getState().setFiles([]); useAppDialog.setState({ queue: [] }); applyVobDocument(document("a")); });
afterEach(() => { delete window.pywebview; useAppDialog.setState({ queue: [] }); });
it("retains per-file edits and undo history until application closure", async () => {
  const first = useVobEditor.getState().rules[0]; if (!first) throw new Error("Missing rule");
  useVobEditor.getState().update(first.id, { comment: "keep me" });
  window.pywebview = { api: { call: async () => ({ ok: true, data: document("b") }) } };
  const switching = vobSwitch("b"); expect(useAppDialog.getState().queue[0]?.kind).toBe("choice");
  useAppDialog.getState().close("keep"); expect(await switching).toBe(true);
  expect(useVobEditor.getState().file?.path).toBe("b");
  await vobSwitch("a");
  expect(useVobEditor.getState().rules[0]?.comment).toBe("keep me");
  expect(useVobEditor.getState().past).toHaveLength(1);
  expect(vobHasChanges(useVobEditor.getState())).toBe(true);
});
it("cancels selection without sending Python an open command", async () => {
  useVobEditor.getState().add(); const call = vi.fn(); window.pywebview = { api: { call } };
  const switching = vobSwitch("b"); useAppDialog.getState().close(null);
  expect(await switching).toBe(false); expect(call).not.toHaveBeenCalled(); expect(useVobEditor.getState().file?.path).toBe("a");
});
it("saves the current document before loading the selected file", async () => {
  useVobEditor.getState().add(); const commands: string[] = [];
  window.pywebview = { api: { call: async (command) => { commands.push(command); return { ok: true, data: command === "vob.save" ? { file: document("a").file } : document("b") }; } } };
  const switching = vobSwitch("b"); useAppDialog.getState().close("save");
  expect(await switching).toBe(true); expect(commands).toEqual(["vob.save", "vob.open"]); expect(useVobEditor.getState().file?.path).toBe("b");
});
it("keeps the active document on failed save and never opens the next file", async () => {
  useVobEditor.getState().add(); const call = vi.fn(async () => ({ ok: false as const, error: { code: "write-error", message: "Cannot write" } }));
  window.pywebview = { api: { call } }; const switching = vobSwitch("b"); useAppDialog.getState().close("save");
  expect(await switching).toBe(false); expect(call).toHaveBeenCalledTimes(1); expect(useVobEditor.getState().file?.path).toBe("a");
});
it("requests files for the selected Allplan version and source", async () => {
  const call = vi.fn(async () => ({ ok: true as const, data: { files: [document("b").file] } })); window.pywebview = { api: { call } };
  await vobListFiles({ version: "2026", source: "STD", allVersions: true } as never); expect(call).toHaveBeenCalledWith("vob.files.list", { version: "2026", source: "STD", allVersions: true, minVersion: 2022, projects: [] });
  expect(useVobEditor.getState().files[0]?.path).toBe("b"); expect(useVobResources.getState().context.version).toBe("2026");
});
it("ignores backups for a different selected VOB file", async () => {
  window.pywebview = { api: { call: async () => ({ ok: true, data: { filePath: "b", files: [{ id: "backup", name: "old", path: "backup/old", createdAt: "2026-10-22T06:00:00Z" }] } }) } };
  await vobListBackups(); expect(useVobResources.getState().backups).toEqual([]);
});
it("requires confirmation before asking Python to restore a backup", async () => {
  const backup = { id: "backup", name: "old", path: "backup/old", createdAt: "2026-10-22T06:00:00Z" };
  useVobResources.setState({ backupFile: "a", backups: [backup] }); const call = vi.fn(); window.pywebview = { api: { call } };
  const restoring = vobRestoreBackup(backup); expect(call).not.toHaveBeenCalled(); useAppDialog.getState().close(null);
  expect(await restoring).toBe(false); expect(call).not.toHaveBeenCalled();
});
it("preserves Python Allplan classification when validating an imported file", async () => {
  const file = { id: "custom", name: "vob_fra.dat", path: "C:/Allplan/2027/STD/vob_fra.dat", version: "2027", source: "STD" };
  const call = vi.fn(async () => ({ ok: true as const, data: { files: [file] } })); window.pywebview = { api: { call } };
  expect(await vobAddFiles([file.path])).toBe(true);
  expect(call).toHaveBeenCalledWith("vob.files.add", { paths: ["C:/Allplan/2027/STD/vob_fra.dat"], multiple: false });
  expect(useVobResources.getState().addedFiles[0]).toEqual(file);
  expect(isAllplanVobFile(file)).toBe(true);
  expect(useVobResources.getState().addedFiles[0]?.path).toBe(file.path);
});
it.each(["ETC", "STD", "PRJ"])("classifies imports in a known %s directory under Allplan 2027", async (source) => {
  const root = `C:/Allplan/2027/${source}`;
  useVobEditor.getState().setFiles([{ id: "known", name: "vob_deu.dat", path: `${root}/vob_deu.dat`, version: "2027", source }]);
  const imported = { id: "new", name: "vob_fra.dat", path: `${root.toLowerCase().replaceAll("/", "\\")}/vob_fra.dat` };
  window.pywebview = { api: { call: async () => ({ ok: true, data: { files: [imported] } }) } };
  await vobAddFiles([imported.path]);
  expect(useVobResources.getState().addedFiles[0]).toMatchObject({ version: "2027", source });
});
it("keeps a similarly named but unmatched directory in user imports", async () => {
  useVobEditor.getState().setFiles([{ id: "known", name: "vob_deu.dat", path: "C:/Allplan/2027/STD/vob_deu.dat", version: "2027", source: "STD" }]);
  const file = { id: "new", name: "vob_fra.dat", path: "C:/User/STD/vob_fra.dat" };
  window.pywebview = { api: { call: async () => ({ ok: true, data: { files: [file] } }) } };
  await vobAddFiles([file.path]);
  expect(useVobResources.getState().addedFiles).toEqual([file]);
  expect(isAllplanVobFile(file)).toBe(false);
});
it("promotes an old user import on refresh and retains its classification in settings", async () => {
  const file = { id: "new", name: "vob_fra.dat", path: "C:/Allplan/2027/ETC/vob_fra.dat" };
  window.pywebview = { api: { call: async (command) => ({ ok: true, data: { files: [command === "vob.files.add" ? file : { ...file, version: "2027", source: "ETC" }] } }) } };
  await vobAddFiles([file.path]); await vobListFiles();
  const settings = collectSettings(["vobResources"]);
  useVobResources.setState({ addedFiles: [] }); applySettings(settings);
  expect(useVobResources.getState().addedFiles[0]).toMatchObject({ version: "2027", source: "ETC" });
  expect(useVobEditor.getState().files).toHaveLength(1);
});
it("inherits the selected project's Allplan version for its PRJ files", async () => {
  const file = { id: "project", name: "vob_fra.dat", path: "C:/Allplan/2027/PRJ/p/vob_fra.dat" };
  window.pywebview = { api: { call: async () => ({ ok: true, data: { project: { name: "p", path: "C:/Allplan/2027/PRJ/p", version: "2027" }, files: [file] } }) } };
  await vobAddProject();
  expect(useVobEditor.getState().files[0]).toMatchObject({ version: "2027", source: "PRJ", projectName: "p" });
});
it("opens the native picker through Python and persists accepted files in settings", async () => {
  const file = { id: "custom", name: "custom.fra", path: "C:/User/custom.fra" };
  const call = vi.fn(async () => ({ ok: true as const, data: { files: [file] } })); window.pywebview = { api: { call } };
  await vobAddFiles(); expect(call).toHaveBeenCalledWith("vob.files.add", { paths: null, multiple: true });
  const settings = collectSettings(["vobResources"]); expect(settings.vobResources).toEqual({ addedFiles: [file], favorites: [], addedProjects: [] });
  useVobResources.setState({ addedFiles: [] }); applySettings(settings);
  expect(useVobResources.getState().addedFiles).toEqual([file]);
});
it("never adds a rejected file or sends a browser-only filename as a path", async () => {
  const call = vi.fn(async () => ({ ok: false as const, error: { code: "invalid-file", message: "Invalid VOB" } })); window.pywebview = { api: { call } };
  expect(await vobAddFiles(["C:/User/bad.fra"])).toBe(false); expect(useVobResources.getState().addedFiles).toEqual([]);
  call.mockClear(); expect(await vobAddFiles(["bad.fra"])).toBe(false); expect(call).not.toHaveBeenCalled();
});
it("keeps added files through inventory refresh and deduplicates normalized paths", async () => {
  const file = { id: "custom", name: "custom.fra", path: "C:/User/custom.fra" };
  window.pywebview = { api: { call: async (command) => ({ ok: true, data: { files: command === "vob.files.add" ? [file] : [{ ...file, id: "listed", path: "c:\\User\\custom.fra" }] } }) } };
  await vobAddFiles([file.path]); await vobListFiles();
  expect(useVobEditor.getState().files).toEqual([file]);
});
it("extracts decoded full paths from native file drop URIs", () => {
  expect(vobDroppedPaths({ files: [] as unknown as FileList, getData: () => "#comment\nfile:///C:/User/my%20file.fra\nhttps://example.com/file" })).toEqual(["C:/User/my file.fra"]);
});it("adds only the chosen project, tags its files PRJ and never opens them", async () => {
  const f = { id: "2027:PRJ:p:vob_deu.dat", name: "vob_deu.dat", path: "C:/Prj/p/vob_deu.dat", version: "2027" };
  const call = vi.fn(async () => ({ ok: true as const, data: { project: { name: "p", path: "C:/Prj/p" }, files: [f] } })); window.pywebview = { api: { call } };
  expect(await vobAddProject()).toBe(true); expect(call).toHaveBeenCalledWith("vob.projects.add", { path: null, multiple: true });
  expect(useVobEditor.getState().files.find((x) => x.path === f.path)?.source).toBe("PRJ"); expect(useVobEditor.getState().file?.path).toBe("a");
  expect(collectSettings(["vobResources"]).vobResources).toMatchObject({ addedProjects: [{ name: "p", path: "C:/Prj/p" }] });
});
it("adds no project when cancelled or when the folder has no VOB", async () => {
  window.pywebview = { api: { call: async () => ({ ok: true, data: null }) } }; expect(await vobAddProject()).toBe(false);
  window.pywebview = { api: { call: async () => ({ ok: true, data: { project: { name: "p", path: "C:/Prj/p" }, files: [] } }) } }; expect(await vobAddProject()).toBe(false);
  expect(useVobResources.getState().addedProjects).toEqual([]);
});
