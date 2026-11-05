// Layer 1 run stream client: sends one run request and reads its NDJSON lines; asks which runs it needs.

import { splitNdjsonChunk } from "./app-ndjson.ts";
import type { ProgressPainter } from "./layer1-progress.ts";
import {
  WireNeedState,
  WireRunStreamKind,
  type WireNeededRun,
  type WireScriptNeedsReply,
  type WireScriptNeedsRequest,
  type WireScriptOutputLine,
  type WireScriptResult,
  type WireScriptRunRequest,
} from "./layer1-wire-script-results.ts";

export type RunReply = { kind: "consent-required" } | { kind: "cancelled" } | { kind: "result"; result: WireScriptResult };

export type RunOutputHandler = (line: WireScriptOutputLine) => void;

// Progress, error and consent lines keep their existing spellings; webapp/ cannot import src/.
type RunStreamLine =
  | { kind: "progress"; label: string; current?: number; total?: number }
  | { kind: "error"; label: string }
  | { kind: "consent-required" }
  | WireScriptOutputLine
  | WireScriptResult;

function buildRouteUrl(pathname: string): string {
  return `${pathname}${location.search}`;
}

function buildPostInit(body: object, signal: AbortSignal): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal };
}

function assertNeededRun(value: unknown): asserts value is WireNeededRun {
  const need = value as Partial<WireNeededRun> | null;
  const isShaped = typeof need?.toolUseId === "string" && typeof need.sessionFile === "string" && typeof need.line === "number" && typeof need.instant === "string";
  const isKnownState = Object.values(WireNeedState).includes(need?.state as WireNeedState);
  const isNeededRun = isShaped && isKnownState;
  if (!isNeededRun) {
    throw new Error(`not a needed run: ${JSON.stringify(value)}`);
  }
}

function assertNeedsReply(value: unknown): asserts value is WireScriptNeedsReply {
  const reply = value as Partial<WireScriptNeedsReply> | null;
  const isShaped = typeof reply?.toolUseId === "string" && Array.isArray(reply.needs);
  if (!isShaped) {
    throw new Error(`not a script-needs reply: ${JSON.stringify(value)}`);
  }
  for (const need of reply!.needs!) {
    assertNeededRun(need);
  }
}

export async function fetchScriptNeeds(request: WireScriptNeedsRequest, signal: AbortSignal): Promise<WireScriptNeedsReply> {
  const response = await fetch(buildRouteUrl("/api/layer1-script-needs"), buildPostInit(request, signal));
  if (!response.ok) {
    throw new Error(await response.text());
  }
  const reply: unknown = await response.json();
  assertNeedsReply(reply);
  return reply;
}

// Every complete line, then the last partial line: a single JSON reply may end without a newline.
async function* readStreamLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    const split = splitNdjsonChunk(remainder, decoder.decode(chunk.value, { stream: true }));
    remainder = split.remainder;
    yield* split.lines;
  }
  if (remainder.length > 0) {
    yield remainder;
  }
}

function reportRunLine(line: RunStreamLine, onProgress: ProgressPainter, onOutput: RunOutputHandler): void {
  if (line.kind === "progress") {
    onProgress(line.label, line.current, line.total);
  }
  if (line.kind === WireRunStreamKind.output) {
    onOutput(line);
  }
}

// Progress and output lines carry no reply; any kind not listed here is a wire break and throws.
function readRunReply(line: RunStreamLine): RunReply | undefined {
  switch (line.kind) {
    case WireRunStreamKind.result:
      return { kind: "result", result: line };
    case "consent-required":
      return { kind: "consent-required" };
    case "error":
      throw new Error(line.label);
    case "progress":
    case WireRunStreamKind.output:
      return undefined;
    default:
      throw new Error(`unknown script run stream line: ${JSON.stringify(line)}`);
  }
}

async function readRunStream(body: ReadableStream<Uint8Array>, onProgress: ProgressPainter, onOutput: RunOutputHandler): Promise<RunReply> {
  for await (const text of readStreamLines(body)) {
    const line = JSON.parse(text) as RunStreamLine;
    reportRunLine(line, onProgress, onOutput);
    const reply = readRunReply(line);
    if (reply !== undefined) {
      return reply;
    }
  }
  throw new Error("the script run stream ended before the result arrived");
}

// An abort is a clean stop the user asked for: it returns cancelled and never throws.
export async function fetchScriptRun(request: WireScriptRunRequest, onProgress: ProgressPainter, onOutput: RunOutputHandler, signal: AbortSignal): Promise<RunReply> {
  try {
    const response = await fetch(buildRouteUrl("/api/layer1-script-run"), buildPostInit(request, signal));
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return await readRunStream(response.body!, onProgress, onOutput);
  }
  catch (error) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    throw error;
  }
}
