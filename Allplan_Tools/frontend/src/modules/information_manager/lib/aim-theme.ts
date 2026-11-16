export function normalizeTheme(value: string | null): "light" | "dark" {
  return value === "dark" ? "dark" : "light";
}