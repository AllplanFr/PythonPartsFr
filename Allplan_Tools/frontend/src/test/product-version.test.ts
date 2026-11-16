import { afterEach, describe, expect, it } from "vitest";
import { productVersion, verifiedAppVersion } from "@/shared/product-version";
import { resetVerifiedIdentity } from "@/shared/transport/native-binding";

describe("product version", () => {
  afterEach(() => resetVerifiedIdentity());
  it("keeps the version provided by Python", () => expect(productVersion("0.1.0")).toBe("0.1.0"));
  it.each([undefined, null, "", "  ", "unknown", "UNKNOWN", 1])("hides %p", (v) => expect(productVersion(v)).toBeNull());
  it("hides the plugin version when no identity was verified (old host / browser)", () => expect(verifiedAppVersion()).toBeNull());
});
