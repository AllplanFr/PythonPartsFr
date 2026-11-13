/** Display assistance only: every item comes from the received Python model. */
export function attributeTooltip(row: {
  number: string;
  label?: string | null;
  definition?: Record<string, unknown> | null;
  title?: string | null;
  widget?: string;
  type?: string;
  value: string | null;
}, context: { group?: string | undefined; category?: string | undefined } = {}): string {
  const label = row.label ?? row.definition?.["label"];
  const widgetLabels: Record<string, string> = { entry: "Saisie libre", combo: "Liste déroulante", list: "Liste sans saisie", checkbox: "Case à cocher" };
  return [
    typeof label === "string" ? `Nom Allplan : ${label}` : null,
    `=N°|${row.number}`,
    row.title !== undefined && row.title !== null ? `=Titre|${row.title}` : null,
    row.widget ? `=Saisie|${widgetLabels[row.widget] ?? row.widget}` : null,
    row.type ? `=Donnée|${row.type}` : null,
    context.group ? `=Groupe|${context.group}` : null,
    context.category ? `=Catégorie|${context.category}` : null,
    row.value !== null ? `=Valeur|${row.value}` : null,
  ].filter((line): line is string => line !== null).join("\n");
}

/** Local selection becomes an embedded image, never a path or remote request. */
export function readCategoryIcon(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string" && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(result)) resolve(result);
      else reject(new Error("Image locale incompatible."));
    };
    reader.onerror = () => reject(new Error("Impossible de lire cette image locale."));
    reader.onabort = () => reject(new Error("Lecture de l’image annulée."));
    reader.readAsDataURL(file);
  });
}