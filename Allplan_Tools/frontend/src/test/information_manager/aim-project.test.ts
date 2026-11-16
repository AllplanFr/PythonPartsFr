import { describe, expect, it } from "vitest";
import { projectValues, valueAfterSwitch } from "@/modules/information_manager/lib/aim-project";
import { resolveStartupTarget } from "@/suite/startup-target";

describe("AIM project values", () => {
  it("matches by number only and ignores unknown numbers", () => {
    const r = projectValues({ "507": "Maison", "99999": "x" }, [507, 508]);
    expect(r.values).toEqual({ 507: "Maison" });
    expect(r.ignored).toEqual([99999]);
  });
  it("keeps a literal 0 distinct from an absent attribute", () => {
    const r = projectValues({ "508": "0" }, [507, 508]);
    expect(valueAfterSwitch(r.values, 508)).toBe("0");
    expect(Object.hasOwn(r.values, 507)).toBe(false);
  });
  it("never inherits values from a previous project", () => {
    const first = projectValues({ "507": "A" }, [507]);
    const second = projectValues({}, [507]);
    expect(valueAfterSwitch(first.values, 507)).toBe("A");
    expect(valueAfterSwitch(second.values, 507)).toBe("");
  });
  it("reports a project without attributes file when values are missing", () => {
    expect(projectValues(undefined, [507]).hasAttributesFile).toBe(false);
    expect(projectValues(null, [507]).hasAttributesFile).toBe(false);
  });
  it("rejects malformed values instead of treating them as empty", () => {
    expect(() => projectValues(["x"], [507])).toThrow();
  });
});

describe("startup target rule", () => {
  const ok = () => true;
  it("explicit target first", () => expect(resolveStartupTarget({ explicit: "a", lastOpened: "b", isAccessible: ok })).toEqual({ kind: "open", path: "a", source: "explicit" }));
  it("then last opened", () => expect(resolveStartupTarget({ lastOpened: "b", isAccessible: ok })).toEqual({ kind: "open", path: "b", source: "last" }));
  it("else managers", () => expect(resolveStartupTarget({ isAccessible: ok })).toEqual({ kind: "manager", reason: "no-target" }));
  it("inaccessible or unknown target opens the manager", () => {
    expect(resolveStartupTarget({ explicit: "a", isAccessible: () => false })).toEqual({ kind: "manager", reason: "inaccessible", path: "a" });
    expect(resolveStartupTarget({ explicit: "a", isAccessible: () => undefined }).kind).toBe("manager");
  });
});
