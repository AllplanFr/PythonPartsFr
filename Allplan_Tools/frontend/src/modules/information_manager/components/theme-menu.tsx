import { aimStorage } from "@/modules/information_manager/lib/aim-storage";
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Lang } from "@/modules/information_manager/lib/i18n";
import { normalizeTheme } from "@/modules/information_manager/lib/aim-theme";
import { aimUiText } from "@/modules/information_manager/lib/aim-ui-text";

type Theme = "light" | "dark";

export function ThemeMenu({ lang }: { lang: Lang }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = aimStorage.getItem("theme"); } catch { /* Storage can be unavailable in WebView2. */ }
    setTheme(normalizeTheme(stored));
    if (stored === "christmas") { try { aimStorage.setItem("theme", "light"); } catch { /* Storage unavailable. */ } }
  }, []);
  useEffect(() => {
    if (theme === null) return;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.remove("christmas");
  }, [theme]);
  const toggleTheme = () => {
    const value = theme === "dark" ? "light" : "dark";
    setTheme(value);
    try { aimStorage.setItem("theme", value); } catch { /* Keep the theme usable without storage. */ }
  };
  const labels = aimUiText(lang);
  const title = theme === "dark" ? labels.lightTheme : labels.darkTheme;
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 p-0" title={title} aria-label={title} onClick={toggleTheme}>
      <Icon className="size-4 text-ribbon-dark" />
    </Button>
  );
}