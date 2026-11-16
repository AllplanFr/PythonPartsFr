import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared title-help works on focus as well as hover around the disabled buttons. */
export function UnavailableRowActions({ number }: { number: string }) {
  return <>{(["Éditer", "Supprimer"] as const).map(action => <span key={action} tabIndex={0} title="Non disponible" aria-label={`${action} ${number} — Non disponible`} className="inline-flex focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
    <Button variant="native" size="native" disabled aria-label={`${action} ${number}`}>
      {action === "Éditer" ? <Pencil className="size-3.5" /> : <Trash2 className="size-3.5" />}
    </Button>
  </span>)}</>;
}