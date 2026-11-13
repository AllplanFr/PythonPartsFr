import type { Lang } from "./i18n";
import type { AimSnapshotStatus } from "./aim-project-contract";

export type HostPhase = "disconnected" | "not-requested" | "loading" | "empty" | "unsupported" | "error" | "available";
export type HostDiagnostic = { code: "unknown-attribute" | "invalid-value" | "missing-catalog" | "transport-error" | "invalid-message"; num?: number; severity: "warning" | "error" };
export type HostState = { phase: HostPhase; diagnostics: HostDiagnostic[] };

/** Every validated contract-2 snapshot is terminal, including cancellation and refusal. */
export function snapshotHostState(status: AimSnapshotStatus): HostState {
  const phase = status === "loaded" || status === "no-attributes" ? "available"
    : status === "none" || status === "cancelled" ? "empty" : "error";
  return { phase, diagnostics: [] };
}

/** Presence is not truthiness: explicit empty, zero and false override previous values. */
export function incomingValue(values: Record<string, unknown>, num: number, previous = ""): string {
  const key = String(num);
  if (!Object.hasOwn(values, key) || values[key] === undefined || values[key] === null) return previous;
  return String(values[key]);
}

const text: Record<Lang, string[]> = {
  fr: ["Hôte non connecté", "Données non demandées", "Chargement Allplan…", "Référentiel vide", "Capacité non prise en charge", "Erreur de chargement", "Données disponibles", "avertissement(s)", "Enregistré dans ce navigateur", "Transmis à Python — écriture non confirmée"],
  en: ["Host disconnected", "Data not requested", "Loading Allplan…", "Empty catalog", "Unsupported capability", "Loading error", "Data available", "warning(s)", "Saved in this browser", "Sent to Python — write unconfirmed"],
  de: ["Host nicht verbunden", "Daten nicht angefordert", "Allplan wird geladen…", "Leerer Katalog", "Funktion nicht unterstützt", "Ladefehler", "Daten verfügbar", "Warnung(en)", "In diesem Browser gespeichert", "An Python gesendet — Schreiben unbestätigt"],
  it: ["Host non connesso", "Dati non richiesti", "Caricamento Allplan…", "Catalogo vuoto", "Funzione non supportata", "Errore di caricamento", "Dati disponibili", "avviso/i", "Salvato in questo browser", "Inviato a Python — scrittura non confermata"],
  es: ["Host desconectado", "Datos no solicitados", "Cargando Allplan…", "Catálogo vacío", "Función no compatible", "Error de carga", "Datos disponibles", "aviso(s)", "Guardado en este navegador", "Enviado a Python — escritura sin confirmar"],
  hr: ["Host nije povezan", "Podaci nisu zatraženi", "Učitavanje Allplana…", "Prazan katalog", "Funkcija nije podržana", "Pogreška učitavanja", "Podaci dostupni", "upozorenje/a", "Spremljeno u ovom pregledniku", "Poslano Pythonu — zapis nije potvrđen"],
  ro: ["Gazdă neconectată", "Date nesolicitate", "Se încarcă Allplan…", "Catalog gol", "Funcție neacceptată", "Eroare la încărcare", "Date disponibile", "avertisment(e)", "Salvat în acest browser", "Trimis la Python — scriere neconfirmată"],
  ru: ["Хост не подключён", "Данные не запрошены", "Загрузка Allplan…", "Пустой каталог", "Функция не поддерживается", "Ошибка загрузки", "Данные доступны", "предупреждение(я)", "Сохранено в этом браузере", "Отправлено Python — запись не подтверждена"],
  cs: ["Hostitel není připojen", "Data nevyžádána", "Načítání Allplanu…", "Prázdný katalog", "Funkce není podporována", "Chyba načítání", "Data dostupná", "varování", "Uloženo v tomto prohlížeči", "Odesláno Pythonu — zápis nepotvrzen"],
  sl: ["Gostitelj ni povezan", "Podatki niso zahtevani", "Nalaganje Allplana…", "Prazen katalog", "Funkcija ni podprta", "Napaka nalaganja", "Podatki so na voljo", "opozorilo/a", "Shranjeno v tem brskalniku", "Poslano Pythonu — zapis ni potrjen"],
  sk: ["Hostiteľ nie je pripojený", "Údaje nevyžiadané", "Načítavanie Allplanu…", "Prázdny katalóg", "Funkcia nie je podporovaná", "Chyba načítania", "Údaje dostupné", "upozornenie/a", "Uložené v tomto prehliadači", "Odoslané Pythonu — zápis nepotvrdený"],
};
const phases: HostPhase[] = ["disconnected", "not-requested", "loading", "empty", "unsupported", "error", "available"];
export function hostStateText(lang: Lang, state: HostState) {
  return `${text[lang][phases.indexOf(state.phase)]}${state.diagnostics.length ? ` · ${state.diagnostics.length} ${text[lang][7]}` : ""}`;
}
export function saveStateText(lang: Lang, connected: boolean): string { return text[lang][connected ? 9 : 8] ?? ""; }