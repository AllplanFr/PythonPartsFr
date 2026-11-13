import { HostError } from "./host-bridge";
import { normalizeAppIdentity } from "@/shared/transport/native-binding";

export const VOB_CLOSE_COMMANDS = ["vob.close.ready", "vob.close.request", "vob.close.cancel", "vob.close.authorize"] as const;
type CloseEvent = { requestId: string; reason: "native_window_close" | "frontend_exit_button" };
type CloseDependencies = {
  call: (command: string, payload: object) => Promise<unknown>;
  ask: () => Promise<boolean>;
  blockLeave: (isCurrent: () => boolean) => Promise<boolean>;
  report: (error: unknown) => void;
  /** Called once after Python confirmed the cancellation ("Return to editing"). */
  stayed?: (preserveDocument?: boolean) => void | Promise<void>;
};
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const nonempty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export function vobCloseAvailable(info: unknown): boolean {
  if (normalizeAppIdentity(info) !== "vob_editor" || !object(info)) return false;
  const capabilities = info["capabilities"];
  return Array.isArray(capabilities) && VOB_CLOSE_COMMANDS.every((command) => capabilities.includes(command));
}

/** One event-owned request and one dialog/save guard, never a browser/native fallback. */
export class VobCloseCoordinator {
  private enabled = false;
  private disposed = false;
  private busy = false;
  private requesting = false;
  private readying = false;
  private seen = new Set<string>();
  private active: CloseEvent | null = null;
  private authorized = false;
  private generation = 0;
  private interrupted = false;
  constructor(private dependencies: CloseDependencies) {}
  get requestId() { return this.active?.requestId ?? null; }
  setEnabled(enabled: boolean) {
    if (this.enabled && !enabled) { this.generation += 1; if (this.active) this.interrupted = true; }
    this.enabled = enabled;
  }
  dispose() { this.setEnabled(false); this.disposed = true; }
  private allowed() { return this.enabled && !this.disposed && !this.authorized; }
  async ready() {
    if (!this.allowed() || this.readying) return;
    this.readying = true;
    try {
      const reply = await this.dependencies.call("vob.close.ready", {});
      if (!object(reply) || reply["status"] !== "ready" || Object.keys(reply).length !== 1) throw new HostError("bad-reply", "vob.close.ready: réponse invalide");
    } catch (error) { if (!this.disposed) this.dependencies.report(error); }
    finally { this.readying = false; }
  }
  async request() {
    if (!this.allowed() || this.requesting || this.busy) return;
    // Manual recovery retains the same event-owned request after transport errors.
    if (this.active) { await this.run(this.active); return; }
    this.requesting = true;
    const generation = this.generation;
    try {
      const reply = await this.dependencies.call("vob.close.request", {});
      if (!this.allowed() || generation !== this.generation) return;
      if (!object(reply) || !nonempty(reply["requestId"]) || !["requested", "reused", "closing"].includes(String(reply["status"])) || Object.keys(reply).length !== 2) throw new HostError("bad-reply", "vob.close.request: réponse invalide");
      // Acknowledgement never opens a dialog or manufactures an active request.
      if (reply["status"] === "closing") this.authorized = true;
    } catch (error) { if (!this.disposed) this.dependencies.report(error); }
    finally { this.requesting = false; }
  }
  receive(raw: unknown) {
    if (!this.allowed()) return;
    if (!object(raw) || !nonempty(raw["requestId"]) || !["native_window_close", "frontend_exit_button"].includes(String(raw["reason"])) || Object.keys(raw).length !== 2) {
      this.dependencies.report(new HostError("bad-reply", "vob.close_requested: événement invalide")); return;
    }
    if (this.seen.has(raw["requestId"])) return;
    if (this.active) { this.dependencies.report(new HostError("bad-reply", "Une demande de fermeture est déjà en cours.")); return; }
    const event: CloseEvent = { requestId: raw["requestId"], reason: raw["reason"] as CloseEvent["reason"] };
    this.active = event; this.interrupted = false; this.seen.add(event.requestId);
    void this.run(event);
  }
  private current(event: CloseEvent) { return this.allowed() && this.active === event; }
  private async finish(event: CloseEvent, authorize: boolean) {
    if (!this.current(event)) return;
    // A interrupted attempt may only cancel, never acquire authorization on reconnection.
    authorize = authorize && !this.interrupted;
    const command = authorize ? "vob.close.authorize" : "vob.close.cancel";
    const reply = await this.dependencies.call(command, { requestId: event.requestId });
    if (!this.current(event)) return;
    if (!object(reply) || reply["requestId"] !== event.requestId) throw new HostError("bad-reply", `${command}: identifiant incohérent`);
    if (reply["status"] === "ignored" && reply["reason"] === "not_current_request" && Object.keys(reply).length === 3) {
      throw new HostError("not_current_request", "Demande de fermeture non courante ; aucune annulation ou autorisation confirmée.");
    }
    if (reply["status"] !== (authorize ? "authorized" : "cancelled") || Object.keys(reply).length !== 2) throw new HostError("bad-reply", `${command}: réponse invalide`);
    this.active = null;
    if (authorize) this.authorized = true; // Accepted, not a claim that the window closed.
  }
  private async run(event: CloseEvent) {
    if (this.busy || !this.current(event)) return;
    this.busy = true;
    const generation = this.generation;
    const isCurrent = () => this.current(event) && generation === this.generation && !this.interrupted;
    try {
      if (this.interrupted) { await this.finish(event, false); if (this.active === null) await this.dependencies.stayed?.(true); return; }
      const quit = await this.dependencies.ask();
      if (!this.current(event)) return;
      if (!isCurrent()) { await this.finish(event, false); if (this.active === null) await this.dependencies.stayed?.(true); return; }
      if (!quit) { await this.finish(event, false); if (this.active === null) await this.dependencies.stayed?.(); return; }
      let blocked = true;
      try { blocked = await this.dependencies.blockLeave(isCurrent); }
      catch (error) { this.dependencies.report(error); }
      if (this.current(event)) {
        const cancel = blocked || !isCurrent();
        await this.finish(event, !cancel);
        if (cancel && this.active === null) await this.dependencies.stayed?.(true);
      }
    } catch (error) { if (!this.disposed) this.dependencies.report(error); }
    finally { this.busy = false; }
  }
}