import { FR, GB, IT, DE, ES, HR, RO, RU, CZ, SI, SK } from "country-flag-icons/react/3x2";
import type { Lang } from "@/modules/information_manager/lib/i18n";
const flags = { fr: FR, en: GB, it: IT, de: DE, es: ES, hr: HR, ro: RO, ru: RU, cs: CZ, sl: SI, sk: SK };
export function MenuFlag({ language }: { language: Lang }) {
  const Flag = flags[language];
  return <span aria-hidden className="inline-flex h-4 w-5 shrink-0 items-center justify-center"><Flag className="h-auto w-5" /></span>;
}