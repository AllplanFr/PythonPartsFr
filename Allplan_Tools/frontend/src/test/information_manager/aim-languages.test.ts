import { describe, expect, it } from "vitest";
import { LANGS, normLang } from "@/modules/information_manager/lib/i18n";

describe("SmartCatalog language compatibility", () => {
  it("accepts exactly the eleven languages verified in SmartCatalog, in its menu order", () => {
    expect(LANGS).toEqual(["fr", "en", "it", "de", "es", "hr", "ro", "ru", "cs", "sl", "sk"]);
    expect(LANGS.map((code) => normLang(code))).toEqual([...LANGS]);
    expect(normLang("pt")).toBeNull();
  });
});