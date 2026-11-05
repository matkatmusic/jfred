// Test support for layer1-run-queue.test.ts: run and view builders, a stubbed server, and the consent clicks.

import assert from "node:assert/strict";
import { resetRunConsent } from "../webapp/layer1-components/popups/layer1-run-consent.ts";
import { resetRunQueue } from "../webapp/layer1-run-queue.ts";
import { resetRunResults } from "../webapp/layer1-run-results.ts";
import { WireNeedState, WireRunOutcome, type WireScriptResult } from "../webapp/layer1-wire-script-results.ts";
import type { WireScriptRun } from "../webapp/layer1-wire-script-runs.ts";
import type { WireLayer1View } from "../webapp/layer1-wire.ts";
import { initLayer1Dom } from "./webapp-dom-test-helpers.ts";

export interface ServerOptions { dependsOn?: Record<string, string[]>; needsStatus?: number; holdRuns?: boolean }
export interface ServerLog { needsCalls: string[]; runCalls: string[]; maxNeeds: number; maxRuns: number; labels: string[] }
interface ServerState { log: ServerLog; saved: Set<string>; needsNow: number; runsNow: number }

const SESSION = "/logs/s1.jsonl";

export function buildRun(id: string, minute: number): WireScriptRun {
  const instant = new Date(Date.UTC(2026, 6, 1, 10, minute)).toISOString();
  return { instant, axisPx: 0, toolUseId: id, executorKind: "python", language: "python", line: minute, code: "x = 1", sessionId: "s1", sessionFile: SESSION };
}

export function buildView(bubbles: Record<string, WireScriptRun[]>): WireLayer1View {
  const pairs: WireLayer1View["pairs"] = [];
  for (const [path, scriptRuns] of Object.entries(bubbles)) {
    pairs.push({ path, commits: [], onDisk: { instant: scriptRuns[0]!.instant, axisPx: 0 }, scriptRuns });
  }
  return { pairs, gitOrphans: [], diskOrphans: [], ruler: [] };
}

export function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitUntil(isDone: () => boolean): Promise<void> {
  for (let turn = 0; turn < 300 && !isDone(); turn++) {
    await waitFor(5);
  }
  assert.ok(isDone(), "the condition never became true");
}

export function encodeLines(lines: object[]): string {
  const encoded: string[] = [];
  for (const line of lines) {
    encoded.push(`${JSON.stringify(line)}\n`);
  }
  return encoded.join("");
}

function buildStream(lines: object[]): Response {
  const bytes = new TextEncoder().encode(encodeLines(lines));
  const body = new ReadableStream({ start(controller) {
    controller.enqueue(bytes);
    controller.close();
  } });
  return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

export function buildResult(id: string): WireScriptResult {
  return { kind: "script-result", toolUseId: id, outcome: WireRunOutcome.replayed, files: [{ path: "a.ts", confidence: "verified" }], stdout: "hi\n", stderr: "", timedOut: false, isOutputSaved: true };
}

function buildNeed(id: string): object {
  return { toolUseId: id, sessionFile: SESSION, line: 1, instant: "2026-07-01T10:00:00.000Z", state: WireNeedState.unreplayed };
}

function listUnsavedNeeds(dependencies: string[], saved: Set<string>): object[] {
  const needs: object[] = [];
  for (const dependency of dependencies) {
    const isSaved = saved.has(dependency);
    if (!isSaved) {
      needs.push(buildNeed(dependency));
    }
  }
  return needs;
}

async function fetchNeedsReply(state: ServerState, options: ServerOptions, id: string): Promise<Response> {
  const { log } = state;
  log.needsCalls.push(id);
  state.needsNow += 1;
  log.maxNeeds = Math.max(log.maxNeeds, state.needsNow);
  await waitFor(10);
  state.needsNow -= 1;
  const status = options.needsStatus ?? 200;
  const needs = listUnsavedNeeds(options.dependsOn?.[id] ?? [], state.saved);
  return { ok: status === 200, status, json: async () => ({ toolUseId: id, needs }), text: async () => "needs route broke" } as unknown as Response;
}

function waitUntilAbort(signal: AbortSignal): Promise<void> {
  return new Promise((_, reject) => {
    const stopHold = (): void => reject(new Error("aborted"));
    signal.addEventListener("abort", stopHold);
  });
}

async function fetchRunReply(state: ServerState, options: ServerOptions, id: string, signal: AbortSignal): Promise<Response> {
  const { log } = state;
  log.runCalls.push(id);
  log.labels.push(document.getElementById("loadbar-label")!.textContent ?? "");
  state.runsNow += 1;
  log.maxRuns = Math.max(log.maxRuns, state.runsNow);
  const hold = waitUntilAbort(signal);
  await (options.holdRuns === true ? hold : waitFor(10));
  state.runsNow -= 1;
  state.saved.add(id);
  return buildStream([{ kind: "script-output", stream: "stdout", text: "hi\n" }, buildResult(id)]);
}

export function installServer(options: ServerOptions = {}): ServerLog {
  const log: ServerLog = { needsCalls: [], runCalls: [], maxNeeds: 0, maxRuns: 0, labels: [] };
  const state: ServerState = { log, saved: new Set<string>(), needsNow: 0, runsNow: 0 };
  const fetchStub = async (url: unknown, init: RequestInit): Promise<Response> => {
    const { toolUseId } = JSON.parse(String(init.body)) as { toolUseId: string };
    const isNeedsRoute = String(url).includes("layer1-script-needs");
    return isNeedsRoute ? fetchNeedsReply(state, options, toolUseId) : fetchRunReply(state, options, toolUseId, init.signal!);
  };
  Object.assign(globalThis, { fetch: fetchStub });
  return log;
}

export function initPage(): void {
  initLayer1Dom("?dir=%2Fw");
  resetRunConsent();
  resetRunQueue();
  resetRunResults();
}

export function triggerConsent(label: string): void {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(".run-consent button")];
  const matching: HTMLButtonElement[] = [];
  for (const button of buttons) {
    if (button.textContent === label) {
      matching.push(button);
    }
  }
  matching[0]!.click();
}

function isConsentShown(): boolean {
  return document.querySelector(".run-consent") !== null;
}

export async function waitAndAcceptConsent(): Promise<void> {
  await waitUntil(isConsentShown);
  triggerConsent("Run scripts");
}
