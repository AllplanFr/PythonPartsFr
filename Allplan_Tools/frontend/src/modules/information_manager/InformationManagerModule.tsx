import { useCallback, useRef } from "react";
import { AimEditor } from "./AimEditor";
import { useLeaveGuard } from "@/suite/leave-guard";

/**
 * Information Manager entry. aim_legacy runs only when the window binding grants it.
 * Legacy Save has no acknowledgement, so leaving with changes is only possible after
 * an explicit discard confirmation (the editor's state lives in the component).
 */
export function InformationManagerModule({ hostEnabled, limitedHost = false }: { hostEnabled: boolean; limitedHost?: boolean }) {
  const dirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => { dirty.current = d; }, []);
  const requestLeave = useRef<(() => Promise<boolean>) | null>(null);
  const onLeaveRequest = useCallback((request: (() => Promise<boolean>) | null) => { requestLeave.current = request; }, []);
  useLeaveGuard({
    isDirty: () => dirty.current,
    ask: async () => requestLeave.current
      ? await requestLeave.current() ? "leave" : "stay"
      : window.confirm("Information Manager : des modifications ne sont pas confirmées comme enregistrées. Les abandonner et quitter ?") ? "leave" : "stay",
  });
  return <div className="aim-module"><AimEditor hostEnabled={hostEnabled} limitedHost={limitedHost} onDirtyChange={onDirtyChange} onLeaveRequest={onLeaveRequest} /></div>;
}
