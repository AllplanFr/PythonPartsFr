import { getVerifiedAppInfo } from "@/shared/transport/native-binding";

/** Product version as provided by Python; absent, empty or "unknown" yields null (never invented). */
export function productVersion(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v && v.toLowerCase() !== "unknown" ? v : null;
}

/** get_app_info().version of the identity verified by the gate in this window. */
export function verifiedAppVersion(): string | null {
  const info = getVerifiedAppInfo();
  return info && typeof info === "object" ? productVersion((info as Record<string, unknown>)["version"]) : null;
}
