import { describe, expect, it } from "vitest";
import { incomingValue } from "@/modules/information_manager/lib/aim-host-state";

describe("Allplan value preservation", () => {
  it("preserves zero as an explicit business value", () => { expect(incomingValue({ "1": 0 }, 1, "old")).toBe("0"); });
  it("preserves false as an explicit business value", () => { expect(incomingValue({ "1": false }, 1, "old")).toBe("false"); });
  it("keeps explicit empty distinct from an absent value", () => { expect(incomingValue({ "1": "" }, 1, "old")).toBe(""); expect(incomingValue({}, 1, "old")).toBe("old"); });
  it("does not turn the unselected sentinel into empty", () => { expect(incomingValue({ "1": -1 }, 1, "old")).toBe("-1"); });
  it("preserves previous data for null or undefined", () => { expect(incomingValue({ "1": null }, 1, "old")).toBe("old"); expect(incomingValue({ "1": undefined }, 1, "old")).toBe("old"); });
});