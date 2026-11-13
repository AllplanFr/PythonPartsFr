import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decodeSurfPreview } from "../lib/surf-preview";
it("decodes the 120×120 cube preview of a .surf file", () => {
  const b = readFileSync("src/test/fixtures/Pierre_01.surf");
  const img = decodeSurfPreview(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  expect(img?.width).toBe(120); expect(img?.height).toBe(120);
});
import { shortImagePath } from "../lib/fill-attributes";
it("shortens a full path to the part after the design folder", () => {
  expect(shortImagePath("C:\\Data\\2026\\Std\\Design\\TEXTURES\\PIERRE\\Pierre 01.surf")).toBe("TEXTURES\\PIERRE\\Pierre 01.surf");
});
