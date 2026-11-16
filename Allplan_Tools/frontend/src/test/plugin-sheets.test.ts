import { describe, expect, it } from "vitest";
import { pluginSheet } from "@/suite/plugin-presentation";

describe("plugin sheets", () => {
  it.each([["fr", "fra", "Présentation"], ["it", "ita", "Presentazione"], ["de", "deu", "Überblick"], ["es", "spa", "Presentación"], ["en", "eng", "Overview"]])("%s loads its own .%s sheet", (lang, code, label) => {
    for (const id of ["smartcatalog", "vob_editor", "information_manager"]) {
      const s = pluginSheet(id, lang)!;
      expect(s.language).toBe(code); expect(s.fallback).toBe(false); expect(s.labels.overview).toBe(label);
    }
  });
  it("falls back explicitly to .eng for a language without sheet", () => {
    const s = pluginSheet("vob_editor", "ru")!;
    expect(s.language).toBe("eng"); expect(s.fallback).toBe(true);
  });
  it("returns no sheet for an unknown plugin", () => { expect(pluginSheet("nope", "fr")).toBeNull(); });
});
