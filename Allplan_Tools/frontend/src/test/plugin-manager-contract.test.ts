import { describe, expect, it } from "vitest";
import { isHomeInfo, isPluginInventoryInfo } from "@/suite/contracts/ALLPLAN_TOOLS_HOME_CONTRACT";

const plugin = (id: string) => ({
  id, name: id, description: "Local plugin", installedVersion: null,
  lifecycle: "ready", launchable: true, available: true,
  reasonCode: null, reason: null, iconUrl: `/plugin-icons/${id}.png`,
});
const info = (plugins: unknown[]) => ({
  home_launch_contract: 1, plugin_inventory_contract: 1,
  context: { year: "2026", verification: false, country: "FRA" }, plugins,
});

describe("extensible installed inventory", () => {
  it.each([0, 1, 4])(
    "accepts an inventory of %i plugins without fixed identities", (count) => {
      expect(isPluginInventoryInfo(info(Array.from({ length: count }, (_, n) => plugin(`local_${n}`))))).toBe(true);
    },
  );
  it("preserves the legacy envelope without requiring three plugins", () => {
    expect(isHomeInfo({ home_launch_contract: 1, context: { year: "", verification: false, country: "" },
      plugins: [{ id: "local_tool", available: true, reason: null }] })).toBe(true);
  });
  it("keeps product versions nullable and preserves non-comparable legacy values", () => {
    for (const installedVersion of [null, "1.2.3", "legacy"]) {
      expect(isPluginInventoryInfo(info([{ ...plugin("local_tool"), installedVersion }]))).toBe(true);
    }
  });
  it("distinguishes construction and resource unavailability", () => {
    for (const [lifecycle, reasonCode] of [["construction", "construction"], ["ready", "unavailable"]]) {
      expect(isPluginInventoryInfo(info([{ ...plugin("local_tool"), lifecycle, reasonCode,
        available: false, launchable: false, reason: "Blocked" }]))).toBe(true);
    }
  });
  it("rejects duplicate identities and caller-command-shaped identities", () => {
    expect(isHomeInfo(info([plugin("same"), plugin("same")]))).toBe(false);
    for (const id of ["", "tool --execute", "../tool", "https://example.com"]) {
      expect(isHomeInfo(info([plugin(id)]))).toBe(false);
    }
  });
  it.each([
    { installedVersion: 1 }, { installedVersion: "" }, { lifecycle: "broken" },
    { launchable: false }, { reasonCode: "unavailable" },
    { lifecycle: "construction", reasonCode: "construction" }, { name: "" },
  ])("rejects inconsistent installed metadata %j", (change) => {
    expect(isPluginInventoryInfo(info([{ ...plugin("local_tool"), ...change }]))).toBe(false);
  });
  it("does not mistake the legacy envelope for the installed inventory contract", () => {
    expect(isPluginInventoryInfo({ home_launch_contract: 1,
      context: { year: "", verification: false, country: "" }, plugins: [] })).toBe(false);
  });
});
