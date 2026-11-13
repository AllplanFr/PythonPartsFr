import { GripVertical, TextCursorInput } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AimActionGlyph } from "./aim-action-glyph";
import { UnavailableRowActions } from "./unavailable-row-actions";
import { StrGlyph } from "./type-glyphs";
import { ValueDisplay, type OutsideAttribute } from "./organized-presentation";
import type { ColumnKey } from "./aim-columns";
import { DICTS, type Lang } from "../lib/i18n";
import { attributeTooltip } from "../lib/presentation-display";

/** Native rows without a presentation: display structure only, no invented occurrence or destination. */
export function NativeAttributesTable({ attributes, columns, lang, renderValue }: {
  attributes: OutsideAttribute[];
  columns: ColumnKey[];
  lang: Lang;
  renderValue?: (row: OutsideAttribute) => ReactNode;
}) {
  const t = DICTS[lang];
  const actions = (a: OutsideAttribute) => <span className="aim-organized-tools flex items-center gap-0.5">
    <Button variant="native" size="native" disabled title="Aucune présentation active" aria-label={`${t.moveTo} ${a.number}`}><AimActionGlyph name="move" /></Button>
    <UnavailableRowActions number={a.number} />
  </span>;
  return <table className="aim-organized-table w-full text-sm">
    <colgroup>{columns.includes("num") && <col className="aim-number-column" />}{columns.includes("title") && <col className="aim-title-column" />}<col />{columns.includes("input") && <col className="aim-kind-column" />}{columns.includes("data") && <col className="aim-kind-column aim-data-column" />}</colgroup>
    <thead className="catalog-panel-heading sticky top-0 z-10 text-left"><tr>
      {columns.includes("num") && <th scope="col">{t.colNum}</th>}{columns.includes("title") && <th scope="col">{t.colTitle}</th>}<th scope="col">{t.colValue}</th>{columns.includes("input") && <th scope="col" className="aim-col-center">{t.colWidget}</th>}{columns.includes("data") && <th scope="col" className="aim-col-center">{t.colType}</th>}
    </tr></thead>
    <tbody>{attributes.map(a => <tr key={a.number} data-attr-number={a.number} data-value-state={a.valueState} className="row-alt border-t border-border">
      {columns.includes("num") && <td data-tip={attributeTooltip(a)} className="text-muted-foreground tabular-nums"><span className="flex items-center gap-1"><span className="aim-row-grip" aria-disabled="true" title="Aucune présentation active"><GripVertical className="size-3.5" /></span>{a.number}</span></td>}
      {columns.includes("title") && <td><span className="aim-readonly-cell block truncate">{a.label}</span></td>}
      <td aria-label={a.label}><div className="flex min-w-0 items-center gap-1">{renderValue ? renderValue(a) : <ValueDisplay valueState={a.valueState} value={a.value} />}{!columns.includes("data") && actions(a)}</div></td>
      {columns.includes("input") && <td className="aim-col-center" title={t.wEntry}><TextCursorInput className="mx-auto size-4 text-muted-foreground" /></td>}
      {columns.includes("data") && <td><div className="aim-data-cell flex items-center gap-2"><span title="STR" className="flex min-w-0 flex-1 justify-center text-muted-foreground"><StrGlyph className="size-4 shrink-0" /></span>{actions(a)}</div></td>}
    </tr>)}</tbody>
  </table>;
}