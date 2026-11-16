import { createElement } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { AimEditor } from "@/modules/information_manager/AimEditor";
import * as catalog from "@/modules/information_manager/lib/attribute-catalog";

/**
 * Exercises the real limitedHost effect of AimEditor (get_initial_data, 15 s bound) with fake timers.
 * createElement is used instead of JSX so the mounted element stays explicit in any text viewer.
 */
const mountLimitedAim = () => render(createElement(AimEditor, { hostEnabled: false, limitedHost: true }));
const VALID = { app: "information_manager", data: { catalog: [{ num: 7, name: "ZZCatalogName" }], attributes: [{ num: 7, title: "ZZRowTitle", widget: "entry", type: "STR" }] } };
type Deferred = { resolve: (v: unknown) => void; reject: (e: unknown) => void };
const TIMEOUT_TEXT = /n’a pas répondu à temps|did not answer in time/;

let deferred: Deferred;
let getInitial: Mock<() => Promise<unknown>>;
let setSpy: MockInstance<typeof setTimeout>;
let clearSpy: MockInstance<typeof clearTimeout>;
const boundTimerId = () => { const i = setSpy.mock.calls.findIndex((c) => c[1] === 15000); return i < 0 ? undefined : setSpy.mock.results[i]?.value; };
const status = () => document.querySelector('[role="status"]')?.textContent ?? "";
const applied = () => Boolean(document.body.textContent?.includes("ZZRowTitle")) || catalog.CATALOG.some((c) => c.num === 7);

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  vi.useFakeTimers();
  localStorage.clear(); catalog.setCatalog([]);
  getInitial = vi.fn(() => new Promise<unknown>((resolve, reject) => { deferred = { resolve, reject }; }));
  (window as unknown as { pywebview: unknown }).pywebview = { api: { get_initial_data: getInitial } };
  setSpy = vi.spyOn(globalThis, "setTimeout"); clearSpy = vi.spyOn(globalThis, "clearTimeout");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); delete (window as unknown as { pywebview?: unknown }).pywebview; });

const reachTimeout = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(status()).toMatch(/Chargement des données de l’hôte|Loading host data/);
  expect(getInitial).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(14800); });
  expect(status()).not.toMatch(TIMEOUT_TEXT);
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(status()).toMatch(TIMEOUT_TEXT);
  expect(status()).not.toMatch(/vide|Empty/i);
};

describe("AIM limited binding: bounded get_initial_data", () => {
  it("pending → loading visible → timeout at 15 s → late valid success ignored, mounted", async () => {
    mountLimitedAim();
    await reachTimeout();
    await act(async () => { deferred.resolve(VALID); await vi.advanceTimersByTimeAsync(60000); });
    expect(applied()).toBe(false);
    expect(status()).toMatch(TIMEOUT_TEXT);
    expect(getInitial).toHaveBeenCalledTimes(1); // no retry
  });

  it("pending → timeout → late rejection of a fresh Promise ignored, mounted", async () => {
    mountLimitedAim();
    await reachTimeout();
    await act(async () => { deferred.reject(new Error("late")); await vi.advanceTimersByTimeAsync(60000); });
    expect(applied()).toBe(false);
    expect(status()).toMatch(TIMEOUT_TEXT);
    expect(status()).not.toMatch(/Échec de lecture|Failed to read/);
    expect(getInitial).toHaveBeenCalledTimes(1); // no retry
  });

  it("clears the bound timer on success and applies the data", async () => {
    mountLimitedAim();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const id = boundTimerId(); expect(id).toBeDefined();
    await act(async () => { deferred.resolve(VALID); await vi.advanceTimersByTimeAsync(10); });
    expect(clearSpy).toHaveBeenCalledWith(id);
    expect(applied()).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(status()).not.toMatch(TIMEOUT_TEXT);
  });

  it("clears the timer on unmount and ignores a reply after unmount", async () => {
    const view = mountLimitedAim();
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const id = boundTimerId(); expect(id).toBeDefined();
    view.unmount();
    expect(clearSpy).toHaveBeenCalledWith(id);
    await act(async () => { deferred.resolve(VALID); await vi.advanceTimersByTimeAsync(20000); });
    expect(catalog.CATALOG).toHaveLength(0);
    expect(getInitial).toHaveBeenCalledTimes(1);
  });
});
