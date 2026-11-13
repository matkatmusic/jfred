// Asking /api/layer1-session-dots: debounce, newest answer wins, loading bar when slow.

import { hideLayer1Progress, renderLayer1Progress } from "../loading-bar/layer1-progress.ts";
import type { InstantRange } from "./layer1-session-dots-viewport.ts";
import type { WireSessionDots } from "./layer1-wire-annotations.ts";

// Same delay as DEBOUNCE_MS in layer1-run-viewport.ts (importing it would make an import cycle).
export const SESSION_DOTS_DEBOUNCE_MS = 150;
export const SESSION_DOTS_SLOW_MS = 1000;
export const LAYER1_PROGRESS_LABEL_LOADING_SESSION_DOTS = "loading session dots";

export interface SessionDotsRequest {
  dir: string;
  jsonlFolders: readonly string[];
  range: InstantRange;
}
export type ReadSessionDotsRequest = () => SessionDotsRequest | undefined;
export type ApplySessionDots = (dots: WireSessionDots) => void;

let debounceTimer: ReturnType<typeof setTimeout> | undefined = undefined;
let newestAskNumber = 0;
let askCountInFlight = 0;
let isSlowBarShown = false;
let pendingRead: ReadSessionDotsRequest | undefined = undefined;
let pendingApply: ApplySessionDots | undefined = undefined;

export function buildSessionDotsUrl(request: SessionDotsRequest): string {
  const params = new URLSearchParams();
  params.set("dir", request.dir);
  for (const folder of request.jsonlFolders) {
    params.append("jsonl", folder);
  }
  params.set("from", request.range.from);
  params.set("to", request.range.to);
  return `/api/layer1-session-dots?${params.toString()}`;
}

export async function fetchSessionDots(request: SessionDotsRequest): Promise<WireSessionDots> {
  const response = await fetch(buildSessionDotsUrl(request));
  if (!response.ok) {
    throw new Error(`session dots ask failed: ${response.status}`);
  }
  return await response.json() as WireSessionDots;
}

function showSlowBar(): void {
  renderLayer1Progress(LAYER1_PROGRESS_LABEL_LOADING_SESSION_DOTS);
  isSlowBarShown = true;
}

function hideSlowBarWhenIdle(): void {
  if (askCountInFlight === 0) {
    if (isSlowBarShown) {
      hideLayer1Progress();
      isSlowBarShown = false;
    }
  }
}

async function fetchWithSlowBar(request: SessionDotsRequest): Promise<WireSessionDots> {
  askCountInFlight += 1;
  const slowTimer = setTimeout(showSlowBar, SESSION_DOTS_SLOW_MS);
  try {
    return await fetchSessionDots(request);
  }
  finally {
    clearTimeout(slowTimer);
    askCountInFlight -= 1;
    hideSlowBarWhenIdle();
  }
}

// Exported so tests skip the debounce.
export async function runSessionDotsFetch(readRequest: ReadSessionDotsRequest, applyDots: ApplySessionDots): Promise<void> {
  const request = readRequest();
  if (request === undefined) {
    return;
  }
  const askNumber = ++newestAskNumber;
  const dots = await fetchWithSlowBar(request);
  const isNewest = askNumber === newestAskNumber;
  if (isNewest) {
    applyDots(dots);
  }
}

function runPendingFetch(): void {
  void runSessionDotsFetch(pendingRead!, pendingApply!);
}

export function scheduleSessionDotsFetch(readRequest: ReadSessionDotsRequest, applyDots: ApplySessionDots): void {
  clearTimeout(debounceTimer);
  pendingRead = readRequest;
  pendingApply = applyDots;
  debounceTimer = setTimeout(runPendingFetch, SESSION_DOTS_DEBOUNCE_MS);
}

// A new view load calls this: later answers become stale.
export function stopSessionDotsFetch(): void {
  clearTimeout(debounceTimer);
  newestAskNumber += 1;
}
