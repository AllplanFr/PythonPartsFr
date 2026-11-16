import { expect, it } from "vitest";
import { completeRoomAttributes, roomChoiceIndex, roomOptions } from "../lib/room-attributes";

it("adding one room attribute adds the other five", () => {
  expect(Object.keys(completeRoomAttributes({ 232: "N" })).map(Number).sort()).toEqual([231, 232, 233, 235, 264, 266]);
});
it("room choices follow the interface language", () => {
  expect(roomOptions(233, "fr")).toEqual(["SH", "SA", "SE", "NH"]);
  expect(roomOptions(232, "hr")).toEqual(["N", "M", "D"]);
  expect(roomOptions(235, "de")[0]).toBe("NUF");
});
it("resolves the initial French occupancy SU to index 0 in English without rewriting it", () => {
  const attrs = { 235: "SU" };
  expect(roomChoiceIndex(235, attrs[235], "en")).toBe(0);
  expect(roomOptions(235, "en")[roomChoiceIndex(235, attrs[235], "en")]).toBe("USA");
  expect(attrs[235]).toBe("SU");
});
it("resolves saved occupancy indices and rejects missing or invalid choices", () => {
  expect(roomChoiceIndex(235, "17", "fr")).toBe(17);
  expect(roomChoiceIndex(235, "", "en")).toBe(-1);
  expect(roomChoiceIndex(235, "not-a-code", "en")).toBe(-1);
});
