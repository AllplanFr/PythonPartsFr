/** Stable display partition: does not sort entries or mutate the supplied sections. */
export function vobUserResourcesFirst<T extends { key: string }>(groups: T[]): T[] {
  return [...groups.filter((g) => g.key === "user"), ...groups.filter((g) => g.key !== "user")];
}