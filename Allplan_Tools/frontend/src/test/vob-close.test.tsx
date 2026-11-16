import { fireEvent, render, cleanup } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { VobEditorModule } from "@/modules/vob_editor/VobEditorModule";

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), dirty: vi.fn<() => string[]>(), save: vi.fn(), ask: vi.fn(), message: vi.fn(), guard: vi.fn(), binding: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate, useBlocker: mocks.guard }));
vi.mock("@/components/editor/VobEditorPage", () => ({ VobEditorPage: ({ onClose }: { onClose: () => Promise<void> }) => <button onClick={() => void onClose()}>Quit</button> }));
vi.mock("@/lib/app-dialog", () => ({ askChoice: mocks.ask, showMessage: mocks.message }));
vi.mock("@/lib/catalog-store", () => ({ useCatalog: { getState: () => ({ lang: "fr" }) } }));
vi.mock("@/lib/vob-resources", () => ({ vobDirtyPaths: mocks.dirty }));
vi.mock("@/lib/vob-bridge", () => ({ vobSaveFiles: mocks.save }));
vi.mock("@/shared/transport/native-binding", async (importOriginal) => ({ ...await importOriginal<typeof import("@/shared/transport/native-binding")>(), detectNativeBinding: mocks.binding }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.dirty.mockReturnValue([]); mocks.binding.mockReturnValue({ kind: "pywebview" });
  mocks.ask.mockResolvedValue("leave"); mocks.save.mockResolvedValue(false);
  vi.spyOn(window, "close").mockImplementation(() => {});
  Object.defineProperty(window, "opener", { configurable: true, value: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const clickQuit = (native = true) => fireEvent.click(render(<VobEditorModule native={native} />).getByRole("button", { name: "Quit" }));

describe("VOB native Quit", () => {
  it("old native host reports unavailable, never closes or goes home", async () => {
    clickQuit();
    await vi.waitFor(() => expect(mocks.message).toHaveBeenCalledTimes(1));
    expect(window.close).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.message).toHaveBeenCalledTimes(1);
  });
  it("cancellation protects dirty files including inactive documents", async () => {
    mocks.dirty.mockReturnValue(["C:/active.dat", "C:/inactive.dat"]); mocks.ask.mockResolvedValue(null);
    clickQuit();
    await vi.waitFor(() => expect(mocks.ask).toHaveBeenCalledTimes(1));
    expect(window.close).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("explicit discard on old host never fabricates native closure", async () => {
    mocks.dirty.mockReturnValue(["C:/inactive.dat"]); clickQuit();
    await vi.waitFor(() => expect(mocks.message).toHaveBeenCalledTimes(1));
    expect(window.close).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("failed save blocks without retry", async () => {
    mocks.dirty.mockReturnValue(["C:/inactive.dat"]); mocks.ask.mockResolvedValue("save"); clickQuit();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith(["C:/inactive.dat"]));
    expect(window.close).not.toHaveBeenCalled(); expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("confirmed save on old host preserves access without a close command", async () => {
    mocks.dirty.mockReturnValue(["C:/inactive.dat"]); mocks.ask.mockResolvedValue("save");
    mocks.save.mockImplementationOnce(async () => { mocks.dirty.mockReturnValue([]); return true; }); clickQuit();
    await vi.waitFor(() => expect(mocks.message).toHaveBeenCalledTimes(1));
    expect(window.close).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("edits arriving during a successful save still block", async () => {
    mocks.dirty.mockReturnValue(["C:/inactive.dat"]); mocks.ask.mockResolvedValue("save"); mocks.save.mockResolvedValue(true); clickQuit();
    await vi.waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(window.close).not.toHaveBeenCalled();
  });
  it("plain browser without opener retains guarded home navigation", async () => {
    mocks.binding.mockReturnValue({ kind: "browser" }); clickQuit(false);
    await vi.waitFor(() => expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/" }));
    expect(window.close).not.toHaveBeenCalled(); expect(mocks.guard).toHaveBeenCalled();
  });
});