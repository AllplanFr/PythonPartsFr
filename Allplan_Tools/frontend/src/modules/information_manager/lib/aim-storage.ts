/**
 * Information Manager browser storage, namespaced inside the shared suite origin.
 * Historical AIM keys ("lang", "theme", "project-attrs-v2", …) become
 * "information_manager:<key>". Keys of other origins/applications are never read,
 * migrated or purged; recovery from the former AIM site is a voluntary export/import.
 */
export const AIM_STORAGE_PREFIX = "information_manager:";
const store = () => (typeof window === "undefined" ? null : window.localStorage);

export const aimStorage = {
  getItem: (key: string) => store()?.getItem(AIM_STORAGE_PREFIX + key) ?? null,
  setItem: (key: string, value: string) => { store()?.setItem(AIM_STORAGE_PREFIX + key, value); },
  removeItem: (key: string) => { store()?.removeItem(AIM_STORAGE_PREFIX + key); },
};
