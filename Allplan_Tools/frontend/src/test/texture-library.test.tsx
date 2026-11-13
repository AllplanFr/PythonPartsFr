import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { designRelativeFilePath, recordTexture, textureChoices, useTextureLibrary } from "../lib/texture-library";
import { ImagePathField } from "../components/editor/FillAttributeField";
import { ATTRIBUTE_CATALOG, useCatalog } from "../lib/catalog-store";
import { AttributeValueRow } from "../components/editor/PropertyPanel";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useTextureLibrary.setState({ entries: [] }); });
const full = "C:\\Data\\2026\\Prj\\B2S - MAISON DEMI NIVEAU 01.prj\\design\\30YearEdition Matériaux\\Revêtements de sol minéraux\\Meadow_01.surf";
const short = "30YearEdition Matériaux\\Revêtements de sol minéraux\\Meadow_01.surf";
it("retains all subfolders after the user's project Design directory", () => {
  expect(designRelativeFilePath(full)).toBe(short);
  expect(designRelativeFilePath(full.replace("C:", "D:"))).toBe(short);
});
it("rejects filename-only fallback and directories other than Design", () => {
  expect(designRelativeFilePath("Meadow_01.surf")).toBeNull();
  expect(designRelativeFilePath("Materials/Meadow_01.surf")).toBeNull();
});
it("returns ten recent and ten frequent textures independently without changing catalog data", () => {
  let entries = recordTexture([], "favorite.surf", true, 1);
  entries = recordTexture(entries, "favorite.surf", true, 2);
  for (let i = 0; i < 12; i++) entries = recordTexture(entries, `${i}.surf`, true, i + 3);
  expect(textureChoices(entries, true)).toHaveLength(10);
  expect(textureChoices(entries, true).some((e) => e.path === "favorite.surf")).toBe(false);
  expect(textureChoices(entries, true, true)).toHaveLength(10);
  expect(textureChoices(entries, true, true)[0]?.path).toBe("favorite.surf");
  expect(textureChoices(entries, false)).toEqual([]);
});
it("unknown attribute remains editable text with multiline values", () => {
  expect(ATTRIBUTE_CATALOG.some((a) => a.num === 999999)).toBe(false);
  const commit = vi.fn();
  render(<AttributeValueRow num={999999} value="" onCommit={commit} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Unknown\nvalue" } });
  fireEvent.blur(screen.getByRole("textbox"));
  expect(commit).toHaveBeenCalledWith("Unknown\nvalue");
});