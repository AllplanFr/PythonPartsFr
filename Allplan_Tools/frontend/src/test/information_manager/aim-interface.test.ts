import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, DEFAULT_SEARCH, makeBackup, matchesSearch, parseBackup, parseLayout, recordHistory, travelHistory } from "@/modules/information_manager/lib/aim-interface";

describe("AIM interface rules", () => {
  it("preserves all project values including empty and unlisted values in backups", () => {
    const presentation = { attributes: [{ num: 479, title: "Nom" }] };
    const backup = makeBackup("Version", "C:/Projet", presentation, [{ num: 479, value: "Dupont" }, { num: 486, value: "" }, { num: 919, value: "1970-05-12" }]);
    expect(backup.values).toEqual({ "479": "Dupont", "486": "", "919": "1970-05-12" });
    expect(backup.data).toEqual(presentation);
  });
  it("rejects restoring a backup from another project", () => {
    const backup = makeBackup("Version", "C:/ProjetA", { attributes: [] }, []);
    expect(() => parseBackup(backup, "C:/ProjetB")).toThrow("wrongProject");
  });
  it("restores both presentation and values through undo/redo", () => {
    const first = { title: "Avant", value: "1", group: "A" };
    const second = { title: "Après", value: "2", group: "B" };
    const history = recordHistory({ past: [], present: first, future: [] }, second);
    const undone = travelHistory(history, "undo");
    expect(undone.present).toEqual(first);
    expect(travelHistory(undone, "redo").present).toEqual(second);
    expect(recordHistory(undone, { ...first, value: "3" }).future).toEqual([]);
  });
  it("enforces match-case search when selected", () => {
    expect(matchesSearch({ title: "Architecte" }, "architecte", DEFAULT_SEARCH)).toBe(true);
    expect(matchesSearch({ title: "Architecte" }, "architecte", { ...DEFAULT_SEARCH, matchCase: true })).toBe(false);
  });
  it("supports search modes without crashing on an invalid regular expression", () => {
    expect(matchesSearch({ title: "Architecte" }, "Archi", { ...DEFAULT_SEARCH, mode: "starts" })).toBe(true);
    expect(matchesSearch({ title: "Architecte" }, "Archi", { ...DEFAULT_SEARCH, mode: "equals" })).toBe(false);
    expect(matchesSearch({ title: "Architecte" }, "[", { ...DEFAULT_SEARCH, mode: "regex" })).toBe(false);
  });
  it("keeps menu layout imports separate from presentation imports", () => {
    expect(parseLayout(DEFAULT_LAYOUT).order).toEqual(["file", "view", "add", "columns", "search"]);
    expect(() => parseLayout({ attributes: [] })).toThrow();
    expect(() => parseLayout({ ...DEFAULT_LAYOUT, order: ["view", "view", "columns", "search"] })).toThrow();
  });
});