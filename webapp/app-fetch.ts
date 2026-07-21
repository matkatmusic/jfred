// ─── shared fetch + caches ───────────────────────────────────────────────────

import { collapseProgressConsole, logProgress } from "./app-console.ts";
import { hideLoadingProgress, showLoadingProgress } from "./app-progress.ts";

// One recorded script execution awaiting consent (wire shape: timestamp is an ISO string;
// readOnly is the server's item-68 verdict — absent means treat as modifying).
export type WireConsentScript = { timestamp: string; cwd?: string; code: string; readOnly?: boolean; source?: { filePath: string; lineNumber: number } };
// The unified document payload is carried opaquely here; views type their own slices.
type WireDocument = Record<string, unknown>;
// The task-56 pre-baseline question payload: which repo/commit the answer is about.
export type WireBaselineQuestion = { baseCommit: string; repo: string };
// One NDJSON line of the /api/document stream: progress lines, the error/consent/
// baseline-question terminals, or the document itself (which has no `kind`).
type WireDocumentStreamLine = WireDocument & {
    kind?: "progress" | "error" | "consent-required" | "baseline-question";
    label?: string;
    current?: number;
    total?: number;
    scripts?: WireConsentScript[];
    baseCommit?: string;
    repo?: string;
};

export const documentCache = new Map<string, WireDocument>();
export const rawLinesCache = new Map<string, string[]>();

// One streamed progress line: always echoed to the console AND driving the always-visible indicator
// — determinate when the line carries a current/total, an indeterminate shimmer otherwise, so a
// countless stage keeps the screen moving instead of freezing on the last counted line (item 82).
function reportStreamProgress(parsed: WireDocumentStreamLine): void {
    logProgress(parsed.current !== undefined ? `${parsed.current}/${parsed.total} ${parsed.label}` : parsed.label!);
    const hasCount = parsed.current !== undefined && parsed.total !== undefined && parsed.total > 0;
    const fraction = hasCount ? parsed.current! / parsed.total! : Number.NaN;
    const detail = hasCount ? `${parsed.label} — ${parsed.current} / ${parsed.total}` : parsed.label!;
    showLoadingProgress(detail, fraction);
}

// Split buffered NDJSON text into complete lines plus the trailing partial line.
export function splitNdjsonChunk(bufferedText: string, chunkText: string): { remainder: string; lines: string[] } {
    const combinedText = bufferedText + chunkText;
    const splitLines = combinedText.split("\n");
    const remainder = splitLines.pop()!;
    const lines = splitLines.filter((line) => line.length > 0);
    return { remainder, lines };
}

// Every server request announces itself in the loading console — its start AND its timed
// completion — so a silent stretch in the console points at the exact endpoint that stalled
// (e.g. a slow /api/projects scan over a huge projects dir). The streamed /api/document endpoint
// goes through fetchDocument instead and logs its own detail.
async function fetchLogged<BodyType>(url: string, readBody: (response: Response) => Promise<BodyType>): Promise<BodyType> {
    const path = new URL(url, location.origin).pathname;
    logProgress(`GET ${path}`);
    const startMs = Date.now();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} -> ${response.status}: ${await response.text()}`);
    const body = await readBody(response);
    logProgress(`  ↳ ${path} ${response.status} (${Date.now() - startMs}ms)`);
    return body;
}

export async function fetchJson<PayloadType = unknown>(url: string): Promise<PayloadType> {
    return fetchLogged<PayloadType>(url, (response) => response.json());
}

export async function fetchText(url: string): Promise<string> {
    return fetchLogged(url, (response) => response.text());
}

// The raw JSONL lines of one transcript, parsed, cached per (project, jsonl).
export async function fetchRawRecords(project: string, jsonl: string): Promise<string[]> {
    const cacheKey = `${project}|${jsonl}`;
    if (!rawLinesCache.has(cacheKey)) {
        const text = await fetchText(`/api/raw?project=${encodeURIComponent(project)}&jsonl=${encodeURIComponent(jsonl)}`);
        rawLinesCache.set(cacheKey, text.split("\n").filter((line) => line.trim().length > 0));
    }
    return rawLinesCache.get(cacheKey)!;
}

// ─── script-execution consent + pre-baseline choice (per-browser-SESSION memory only, by design) ──

const CONSENT_KEY_PREFIX = "consent:";
// task 56: the pre-baseline answer, stored per project exactly like the consent choice.
const BASELINE_KEY_PREFIX = "baseline:";
// Prefixes of per-project choices a server relaunch must forget (boot-id sweep below).
const CHOICE_KEY_PREFIXES = [CONSENT_KEY_PREFIX, BASELINE_KEY_PREFIX];

function computeConsentKey(project: string): string {
    return `${CONSENT_KEY_PREFIX}${project}`;
}

export function storeConsentChoice(project: string, choice: string): void {
    sessionStorage.setItem(computeConsentKey(project), choice);
}

// "1" (run), "0" (declined), or null (not asked yet this session).
export function getConsentChoice(project: string): string | null {
    return sessionStorage.getItem(computeConsentKey(project));
}

function computeBaselineKey(project: string): string {
    return `${BASELINE_KEY_PREFIX}${project}`;
}

export function storeBaselineChoice(project: string, choice: string): void {
    sessionStorage.setItem(computeBaselineKey(project), choice);
}

// "1" (reconstruct pre-baseline), "0" (start at the baseline commit), or null (not asked yet).
export function getBaselineChoice(project: string): string | null {
    return sessionStorage.getItem(computeBaselineKey(project));
}

// The server stamps each process launch with a boot id (GET /api/config). Consent choices live in
// sessionStorage, which survives both a page reload AND a server restart — so after relaunching the
// server (e.g. to drop the sandbox memo) a reloaded page would silently reuse the old "Run"/"declined"
// choice and never re-prompt. When the boot id changes we know the server was relaunched and clear
// every remembered consent choice so the next load re-prompts. The boot id shares sessionStorage's
// per-tab lifetime, so a brand-new tab (empty storage) simply stores the current id with nothing to clear.
const SERVER_BOOT_ID_KEY = "serverBootId";

export function reconcileServerBootId(bootId: string): void {
    if (sessionStorage.getItem(SERVER_BOOT_ID_KEY) === bootId) {
        return;
    }
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key !== null && CHOICE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
            sessionStorage.removeItem(key);
        }
    }
    sessionStorage.setItem(SERVER_BOOT_ID_KEY, bootId);
}

// Fetch a document under the consent protocol. Resolves to { document } or
// { consentRequired: scripts[] } — the caller renders the dialog for the latter.
// The already-fetched unified document for a project, or undefined — never triggers a build.
// The drawer uses this so navigating to a conversation doesn't force a whole-project build.
export function peekCachedDocument<DocumentType = WireDocument>(project: string): DocumentType | undefined {
    return documentCache.get(`${project}|*`) as DocumentType | undefined;
}

// The one in-flight document load. renderRoute aborts it on every navigation (previously two
// hashchanges raced duplicate stream reads); the console Cancel button aborts it on demand.
export let inflightLoadController: AbortController | undefined;

function setCancelButtonVisible(visible: boolean): void {
    const button = document.getElementById("console-cancel") as HTMLButtonElement;
    button.hidden = !visible;
    button.disabled = false; // any visibility change ends a pending cancel
}

// Only the terminal document payload is ever this large; progress lines are tiny. Gating on size
// lets the tiny lines parse inline while the one huge line gets a visible "parsing document" label
// and a paint-yield first, so the browser's synchronous JSON.parse of ~67 MB no longer freezes the
// tab with a stale indicator (item 82).
const LARGE_PAYLOAD_BYTES = 200_000;

export function formatMegabytes(byteLength: number): string {
    return `${(byteLength / 1_000_000).toFixed(1)} MB`;
}

// One decoded NDJSON chunk's complete lines: progress lines land in the console; each
// non-progress line replaces the running terminal-payload candidate, which is returned.
async function parseDocumentStreamLines(lines: string[], finalPayload: WireDocumentStreamLine): Promise<WireDocumentStreamLine> {
    for (const line of lines) {
        if (line.length > LARGE_PAYLOAD_BYTES) {
            // The terminal document line; its JSON.parse blocks the tab for seconds. Show a
            // label and yield so the browser paints it (and the shimmer) before parsing. (item 82)
            showLoadingProgress(`parsing document — ${formatMegabytes(line.length)}`, Number.NaN);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const parsed = JSON.parse(line) as WireDocumentStreamLine;
        if (parsed.kind === "progress") {
            reportStreamProgress(parsed);
        } else {
            finalPayload = parsed;
        }
    }
    return finalPayload;
}

// DocumentType lets each view name the wire fields it reads (its own Wire* type); the cache and
// stream handling below stay shape-agnostic.
export async function fetchDocument<DocumentType = WireDocument>(project: string, jsonl?: string): Promise<{ document?: DocumentType; consentRequired?: WireConsentScript[]; baselineQuestion?: WireBaselineQuestion }> {
    const cacheKey = `${project}|${jsonl ?? "*"}`;
    if (documentCache.has(cacheKey)) return { document: documentCache.get(cacheKey)! as DocumentType };
    const params = new URLSearchParams({ project, progress: "1" });
    if (jsonl !== undefined) params.set("jsonl", jsonl);
    const choice = sessionStorage.getItem(computeConsentKey(project));
    params.set("allowScripts", choice === "1" ? "1" : "0");
    if (choice === "0") params.set("declined", "1");
    // task 56: an absent choice sends NO param — that is what lets the server ask.
    const baselineChoice = getBaselineChoice(project);
    if (baselineChoice !== null) params.set("preBaseline", baselineChoice);
    const controller = new AbortController();
    inflightLoadController = controller;
    setCancelButtonVisible(true);
    try {
        // The server does its consent-decision parse (and, for a project view, a full projects scan)
        // BEFORE it writes headers — that work is silent until the stream opens. Time to first byte
        // exposes it, so a gap before the first "loading …" line is attributable to the server.
        logProgress(`GET /api/document jsonl=${jsonl ?? "(all)"}`);
        const requestStartMs = Date.now();
        const response = await fetch(`/api/document?${params}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`document ${response.status}: ${await response.text()}`);
        logProgress(`  ↳ /api/document responding (${Date.now() - requestStartMs}ms to first byte)`);
        // NDJSON stream: each progress line lands in the console; the last non-progress line is the
        // terminal payload — a document, a consent decision, or a build error.
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let remainder = "";
        let finalPayload!: WireDocumentStreamLine;
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            let lines: string[];
            ({ remainder, lines } = splitNdjsonChunk(remainder, decoder.decode(value, { stream: true })));
            finalPayload = await parseDocumentStreamLines(lines, finalPayload);
        }
        // A real document has no `kind` field; consent/error/baseline ride the kind discriminant.
        if (finalPayload.kind === "error") throw new Error(finalPayload.label);
        if (finalPayload.kind === "consent-required") return { consentRequired: finalPayload.scripts };
        if (finalPayload.kind === "baseline-question") {
            return { baselineQuestion: { baseCommit: finalPayload.baseCommit!, repo: finalPayload.repo! } };
        }
        documentCache.set(cacheKey, finalPayload);
        // item 66: this load actually streamed (cache miss) and completed — auto-collapse the
        // console shortly after so the timeline gets the vertical space back.
        setTimeout(collapseProgressConsole, 400);
        return { document: finalPayload as DocumentType };
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") logProgress("load cancelled");
        throw error;
    } finally {
        // The reconstruction bar belongs to THIS stream; drop it when the stream ends (success,
        // consent, error, or abort). The timeline row build (item 78) re-shows its own bar after.
        hideLoadingProgress();
        if (inflightLoadController === controller) {
            inflightLoadController = undefined;
            setCancelButtonVisible(false);
        }
    }
}
