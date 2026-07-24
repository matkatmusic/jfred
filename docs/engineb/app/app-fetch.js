// ─── shared fetch + caches ───────────────────────────────────────────────────
import { computeConsentKey, getBaselineChoice, getModeChoice } from "./app-choices.js";
import { collapseProgressConsole, logProgress } from "./app-console.js";
import { hideLoadingProgress, showLoadingProgress } from "./app-progress.js";
export const documentCache = new Map();
export const rawLinesCache = new Map();
// One streamed progress line: always echoed to the console AND driving the always-visible indicator
// — determinate when the line carries a current/total, an indeterminate shimmer otherwise, so a
// countless stage keeps the screen moving instead of freezing on the last counted line (item 82).
function reportStreamProgress(parsed) {
    logProgress(parsed.current !== undefined ? `${parsed.current}/${parsed.total} ${parsed.label}` : parsed.label);
    const hasCount = parsed.current !== undefined && parsed.total !== undefined && parsed.total > 0;
    const fraction = hasCount ? parsed.current / parsed.total : Number.NaN;
    const detail = hasCount ? `${parsed.label} — ${parsed.current} / ${parsed.total}` : parsed.label;
    showLoadingProgress(detail, fraction);
}
// Split buffered NDJSON text into complete lines plus the trailing partial line.
export function splitNdjsonChunk(bufferedText, chunkText) {
    const combinedText = bufferedText + chunkText;
    const splitLines = combinedText.split("\n");
    const remainder = splitLines.pop();
    const lines = splitLines.filter((line) => line.length > 0);
    return { remainder, lines };
}
// Every server request announces itself in the loading console — its start AND its timed
// completion — so a silent stretch in the console points at the exact endpoint that stalled
// (e.g. a slow /api/projects scan over a huge projects dir). The streamed /api/document endpoint
// goes through fetchDocument instead and logs its own detail.
async function fetchLogged(url, readBody) {
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
export async function fetchJson(url) {
    return fetchLogged(url, (response) => response.json());
}
export async function fetchText(url) {
    return fetchLogged(url, (response) => response.text());
}
// The raw JSONL lines of one transcript, parsed, cached per (project, jsonl).
export async function fetchRawRecords(project, jsonl) {
    const cacheKey = `${project}|${jsonl}`;
    if (!rawLinesCache.has(cacheKey)) {
        const text = await fetchText(`/api/raw?project=${encodeURIComponent(project)}&jsonl=${encodeURIComponent(jsonl)}`);
        rawLinesCache.set(cacheKey, text.split("\n").filter((line) => line.trim().length > 0));
    }
    return rawLinesCache.get(cacheKey);
}
// ─── consent + pre-baseline choices: moved to app-choices.ts (task 152, 250-line cap) ──────────
// task 152: evict one project's cached documents — a cache hit would answer from memory and
// the re-posed question would never reach the wire.
export function dropProjectDocuments(project) {
    for (const key of [...documentCache.keys()]) {
        if (key.startsWith(`${project}|`)) {
            documentCache.delete(key);
        }
    }
}
// Fetch a document under the consent protocol. Resolves to { document } or
// { consentRequired: scripts[] } — the caller renders the dialog for the latter.
// The already-fetched unified document for a project, or undefined — never triggers a build.
// The drawer uses this so navigating to a conversation doesn't force a whole-project build.
export function peekCachedDocument(project) {
    return documentCache.get(`${project}|*`);
}
// The one in-flight document load. renderRoute aborts it on every navigation (previously two
// hashchanges raced duplicate stream reads). task 164: the progress box's Cancel navigates to
// "#/", which aborts through that same renderRoute path — the old #console-cancel button and
// its setCancelButtonVisible toggling are retired.
export let inflightLoadController;
// Only the terminal document payload is ever this large; progress lines are tiny. Gating on size
// lets the tiny lines parse inline while the one huge line gets a visible "parsing document" label
// and a paint-yield first, so the browser's synchronous JSON.parse of ~67 MB no longer freezes the
// tab with a stale indicator (item 82).
const LARGE_PAYLOAD_BYTES = 200_000;
export function formatMegabytes(byteLength) {
    return `${(byteLength / 1_000_000).toFixed(1)} MB`;
}
// One decoded NDJSON chunk's complete lines: progress lines land in the console; each
// non-progress line replaces the running terminal-payload candidate, which is returned.
async function parseDocumentStreamLines(lines, finalPayload) {
    for (const line of lines) {
        if (line.length > LARGE_PAYLOAD_BYTES) {
            // The terminal document line; its JSON.parse blocks the tab for seconds. Show a
            // label and yield so the browser paints it (and the shimmer) before parsing. (item 82)
            showLoadingProgress(`parsing document — ${formatMegabytes(line.length)}`, Number.NaN);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const parsed = JSON.parse(line);
        if (parsed.kind === "progress") {
            reportStreamProgress(parsed);
        }
        else {
            finalPayload = parsed;
        }
    }
    return finalPayload;
}
// DocumentType lets each view name the wire fields it reads (its own Wire* type); the cache and
// stream handling below stay shape-agnostic.
export async function fetchDocument(project, jsonl) {
    // task 194: a stored bounded-mode choice rides as boundFile/boundNth (absent = full build).
    // The bound is in the cache key too — a bounded and a full document must never share one.
    const modeChoice = getModeChoice(project);
    const boundKeySuffix = modeChoice?.mode === "bounded" ? `|${modeChoice.file}#${modeChoice.nth}` : "";
    const cacheKey = `${project}|${jsonl ?? "*"}${boundKeySuffix}`;
    if (documentCache.has(cacheKey))
        return { document: documentCache.get(cacheKey) };
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
        // The server does its consent-decision parse (and, for a project view, a full projects scan)
        // BEFORE it writes headers — that work is silent until the stream opens. Time to first byte
        // exposes it, so a gap before the first "loading …" line is attributable to the server.
        logProgress(`GET /api/document jsonl=${jsonl ?? "(all)"}`);
        const requestStartMs = Date.now();
        const response = await fetch(`/api/document?${params}`, { signal: controller.signal });
        if (!response.ok)
            throw new Error(`document ${response.status}: ${await response.text()}`);
        logProgress(`  ↳ /api/document responding (${Date.now() - requestStartMs}ms to first byte)`);
        // NDJSON stream: each progress line lands in the console; the last non-progress line is the
        // terminal payload — a document, a consent decision, or a build error.
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let remainder = "";
        let finalPayload;
        for (;;) {
            const { value, done } = await reader.read();
            if (done)
                break;
            let lines;
            ({ remainder, lines } = splitNdjsonChunk(remainder, decoder.decode(value, { stream: true })));
            finalPayload = await parseDocumentStreamLines(lines, finalPayload);
        }
        // A real document has no `kind` field; consent/error/baseline ride the kind discriminant.
        if (finalPayload.kind === "error")
            throw new Error(finalPayload.label);
        if (finalPayload.kind === "consent-required")
            return { consentRequired: finalPayload.scripts };
        if (finalPayload.kind === "baseline-question") {
            return { baselineQuestion: { baseCommit: finalPayload.baseCommit, repo: finalPayload.repo } };
        }
        documentCache.set(cacheKey, finalPayload);
        // item 66: this load actually streamed (cache miss) and completed — auto-collapse the
        // console shortly after so the timeline gets the vertical space back.
        setTimeout(collapseProgressConsole, 400);
        return { document: finalPayload };
    }
    catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
            logProgress("load cancelled");
        throw error;
    }
    finally {
        // The reconstruction bar belongs to THIS stream; drop it when the stream ends (success,
        // consent, error, or abort). The timeline row build (item 78) re-shows its own bar after.
        hideLoadingProgress();
        if (inflightLoadController === controller) {
            inflightLoadController = undefined;
        }
    }
}
