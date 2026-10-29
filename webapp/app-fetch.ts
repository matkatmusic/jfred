// ─── shared fetch + caches ───────────────────────────────────────────────────

import { computeConsentKey, getBaselineChoice, getModeChoice } from "./app-choices.ts";
import { closeProgressConsole, logProgress } from "./app-console.ts";
import { hideLoadingProgress } from "./app-progress.ts";
import { readDocumentStream } from "./app-fetch-stream.ts";

// One recorded script awaiting consent (timestamp is an ISO string; readOnly absent means treat as modifying).
export type WireConsentScript = { timestamp: string; cwd?: string; code: string; readOnly?: boolean; source?: { filePath: string; lineNumber: number } };
// The unified document payload is carried opaquely here; views type their own slices.
export type WireDocument = Record<string, unknown>;
// The task-56 pre-baseline question payload: which repo/commit the answer is about.
export type WireBaselineQuestion = { baseCommit: string; repo: string };

export const documentCache = new Map<string, WireDocument>();
export const rawLinesCache = new Map<string, string[]>();

// Every server request logs its start and timed completion, so a silent console gap names the stalled endpoint.
async function fetchLogged<BodyType>(url: string, readBody: (response: Response) => Promise<BodyType>): Promise<BodyType> {
  const path = new URL(url, location.origin).pathname;
  logProgress(`GET ${path}`);
  const startMs = Date.now();
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`${url} -> ${response.status}: ${await response.text()}`);
  const body = await readBody(response);
  logProgress(`  ↳ ${path} ${response.status} (${Date.now() - startMs}ms)`);
  return body;
}

function readResponseJson<BodyType>(response: Response): Promise<BodyType> {
  return response.json();
}

function readResponseText(response: Response): Promise<string> {
  return response.text();
}

export async function fetchJson<PayloadType = unknown>(url: string): Promise<PayloadType> {
  return fetchLogged<PayloadType>(url, readResponseJson);
}

export async function fetchText(url: string): Promise<string> {
  return fetchLogged(url, readResponseText);
}

// The raw JSONL lines of one transcript, parsed, cached per (project, jsonl).
export async function fetchRawRecords(project: string, jsonl: string): Promise<string[]> {
  const cacheKey = `${project}|${jsonl}`;
  const isCached = rawLinesCache.has(cacheKey);
  if (!isCached) {
    const text = await fetchText(`/api/raw?project=${encodeURIComponent(project)}&jsonl=${encodeURIComponent(jsonl)}`);
    const nonBlankLines: string[] = [];
    for (const line of text.split("\n")) {
      const isBlank = line.trim().length === 0;
      if (!isBlank)
        nonBlankLines.push(line);
    }
    rawLinesCache.set(cacheKey, nonBlankLines);
  }
  return rawLinesCache.get(cacheKey)!;
}

// task 152: evict one project's cached documents so the re-posed question reaches the wire.
export function clearProjectDocuments(project: string): void {
  for (const key of [...documentCache.keys()]) {
    const isProjectKey = key.startsWith(`${project}|`);
    if (isProjectKey) {
      documentCache.delete(key);
    }
  }
}

// The already-fetched unified document for a project, or undefined; never triggers a build.
export function getCachedDocument<DocumentType = WireDocument>(project: string): DocumentType | undefined {
  return documentCache.get(`${project}|*`) as DocumentType | undefined;
}

// The one in-flight document load. renderRoute aborts it on every navigation; the progress box's Cancel navigates to "#/".
export let inflightLoadController: AbortController | undefined;

// Fetch a document under the consent protocol: resolves to { document }, { consentRequired }, or { baselineQuestion }.
export async function fetchDocument<DocumentType = WireDocument>(project: string, jsonl?: string): Promise<{ document?: DocumentType; consentRequired?: WireConsentScript[]; baselineQuestion?: WireBaselineQuestion }> {
  // task 194: a bounded-mode choice rides as boundFile/boundNth and is in the cache key too.
  const modeChoice = getModeChoice(project);
  const boundKeySuffix = modeChoice?.mode === "bounded" ? `|${modeChoice.file}#${modeChoice.nth}` : "";
  const cacheKey = `${project}|${jsonl ?? "*"}${boundKeySuffix}`;
  const isCached = documentCache.has(cacheKey);
  if (isCached)
    return { document: documentCache.get(cacheKey)! as DocumentType };
  const params = new URLSearchParams({ project, progress: "1" });
  if (jsonl !== undefined)
    params.set("jsonl", jsonl);
  if (modeChoice?.mode === "bounded") {
    params.set("boundFile", modeChoice.file);
    params.set("boundNth", String(modeChoice.nth));
  }
  const choice = sessionStorage.getItem(computeConsentKey(project));
  params.set("allowScripts", choice === "1" ? "1" : "0");
  if (choice === "0")
    params.set("declined", "1");
  // task 56: an absent choice sends NO param — that is what lets the server ask.
  const baselineChoice = getBaselineChoice(project);
  if (baselineChoice !== null)
    params.set("preBaseline", baselineChoice);
  const controller = new AbortController();
  inflightLoadController = controller;
  try {
    // The server works silently before it writes headers; time to first byte attributes that gap to the server.
    logProgress(`GET /api/document jsonl=${jsonl ?? "(all)"}`);
    const requestStartMs = Date.now();
    const response = await fetch(`/api/document?${params}`, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`document ${response.status}: ${await response.text()}`);
    logProgress(`  ↳ /api/document responding (${Date.now() - requestStartMs}ms to first byte)`);
    // NDJSON stream: the last non-progress line is the terminal payload (document, consent decision, or error).
    const finalPayload = await readDocumentStream(response);
    // A real document has no `kind` field; consent/error/baseline ride the kind discriminant.
    if (finalPayload.kind === "error")
      throw new Error(finalPayload.label);
    if (finalPayload.kind === "consent-required")
      return { consentRequired: finalPayload.scripts };
    if (finalPayload.kind === "baseline-question") {
      return { baselineQuestion: { baseCommit: finalPayload.baseCommit!, repo: finalPayload.repo! } };
    }
    documentCache.set(cacheKey, finalPayload);
    // item 66: after a streamed load, auto-collapse the console so the timeline regains the space.
    setTimeout(closeProgressConsole, 400);
    return { document: finalPayload as DocumentType };
  }
  catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    if (isAbort)
      logProgress("load cancelled");
    throw error;
  }
  finally {
    // The reconstruction bar belongs to THIS stream; drop it when the stream ends.
    hideLoadingProgress();
    if (inflightLoadController === controller) {
      inflightLoadController = undefined;
    }
  }
}

