import { FR, GB, IT, DE, ES, HR, RO, RU, CZ, SI, SK, CH, AU, CA } from "country-flag-icons/react/3x2";

const flags = { fr: FR, en: GB, it: IT, de: DE, es: ES, hr: HR, ro: RO, ru: RU, cs: CZ, sl: SI, sk: SK, ch: CH, au: AU, ca: CA };
const fileCountries: Record<string, keyof typeof flags> = { deu: "de", swi: "ch", aus: "au", can: "ca", eng: "en", fra: "fr", ita: "it", spa: "es" };

/** Filename territory takes precedence over language: Swiss Italian keeps a Swiss flag. */
export function MenuFlag({ language, filename }: { language?: string; filename?: string }) {
  const territory = filename?.toLowerCase().match(/_([a-z]{3})(?:\.|$)/)?.[1];
  const extension = filename?.split(".").at(-1)?.toLowerCase();
  const key = language ?? fileCountries[territory ?? ""] ?? fileCountries[extension ?? ""];
  const Flag = key && key in flags ? flags[key as keyof typeof flags] : undefined;
  return <span aria-hidden="true" className="inline-flex h-4 w-5 shrink-0 items-center justify-center">{Flag && <Flag className="h-auto w-5" />}</span>;
}