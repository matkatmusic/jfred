// The build-heavy API route handlers split out of viewer_server.ts (task 92): /api/document,
// /api/diff, /api/range-patch, /api/step-files, plus the shared response/param helpers the
// router in viewer_server.ts also uses. All logic lives in viewer_api*.ts; this file only
// parses requests, dispatches, and serializes responses.

import { type ServerResponse } from "node:http";
import {
    buildDocumentWithConsent,
    buildReconstructionWithConsent,
    decideBaselineQuestion,
    decideDocumentResponse,
    PROGRESS_LABEL_SERIALIZING_DOCUMENT,
    formatSendingDocumentLabel,
} from "./viewer_api.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { resolveJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import {
    renderRevisionDiff,
    renderDiffVsBase,
    renderRangePatch,
    parseRangePatchQuery,
    parseStepFilesQuery,
    resolveStepFiles,
} from "./viewer_api_diffs.ts";
import { DocumentResponseKind } from "./structures/vocabulary.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import { Path } from "./structures/domain.ts";

export function sendJson(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(value));
}

export function sendText(response: ServerResponse, status: number, text: string, contentType = "text/plain; charset=utf-8"): void {
    response.writeHead(status, { "Content-Type": contentType });
    response.end(text);
}

export function requireParam(query: URLSearchParams, name: string): string {
    const value = query.get(name);
    if (value === null) {
        throw new Error(`missing query param: ${name}`);
    }
    return value;
}

// resolveJsonlPaths moved to viewer_api_sources.ts (task 177: this file is at the 250-line
// cap, and the multi-source union belongs beside the project scanning it composes).

// Build-stage progress mirrored to the server console: after the transcripts load, the synchronous
// build is otherwise silent on stdout, so tailing the server log shows one live line per unit of
// engine work (stage labels, per-file reconstruction counts, script sandbox runs). The sink wired
// through buildDocumentWithConsent never carries the per-record parse walk, so the volume stays
// one line per stage/file/run, not per record.
const logBuildProgressToConsole: ProgressSink = (event) => {
    const counter = event.current === undefined ? "" : ` (${event.current}/${event.total})`;
    console.log(`   ${event.label}${counter}`);
};

// GET /api/document — the built document, or a consent-required decision when scripts need a
// yes. With progress=1 the same result streams as NDJSON: one progress line per unit of work, the
// normal response object as the final line. The progress path opens the stream up front and then
// runs AND logs every stage the non-progress path does silently (file resolution, the
// consent-decision parse of every file, the script scan), so a gap in the console maps to a named
// stage rather than a blind wait before the first byte.
export function handleDocumentRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");   // a missing project still 400s (before any header)
    const jsonlName = query.get("jsonl");
    const allowScripts = query.get("allowScripts") === "1";
    // task 56: "1"/"0" = the user's pre-baseline answer; null = not asked yet (gate below).
    const preBaselineChoice = query.get("preBaseline");
    const reconstructPreBaseline = preBaselineChoice !== "0";
    const targetValue = query.get("target");
    const target = targetValue === null ? undefined : new Path(targetValue);
    // declined=1 is the client's remembered "Continue without running" — build degraded, no re-prompt.
    const declined = query.get("declined") === "1";
    // task 194: bounded mode — reconstruct only until boundFile's boundNth-revision turn end
    // (task-193 semantics). Absent boundFile = full reconstruction, today's behavior.
    const boundFileValue = query.get("boundFile");
    const bound = boundFileValue === null
        ? undefined
        : { file: new Path(boundFileValue), ordinal: Number(query.get("boundNth") ?? "1") };
    // item 46: the project's path overrides apply to everything below (both branches). Runs
    // before any header goes out, so a malformed reveng-paths.json still 400s loudly.
    applyProjectOverrides(projectName);
    // task 56: a configured base commit needs the user's answer BEFORE any consent scan or build.
    const baselineQuestion = decideBaselineQuestion(preBaselineChoice !== null);

    // Non-progress path: resolve + consent-decide + respond, all BEFORE any header, so a resolver
    // refusal (bad project, traversal) still becomes a 400 via the outer catch. Consent-required is
    // HTTP 200 with the kind discriminant (not 428) so browsers don't log the expected flow as an error.
    if (query.get("progress") !== "1") {
        if (baselineQuestion !== undefined) {
            sendJson(response, 200, baselineQuestion);
            return;
        }
        const jsonlPaths = resolveJsonlPaths(projectName, jsonlName);
        const { records } = loadProjectRecords(jsonlPaths);
        const decision = decideDocumentResponse(records, allowScripts);
        if (decision.kind === DocumentResponseKind.consentRequired && !declined) {
            sendJson(response, 200, decision);
            return;
        }
        sendJson(response, 200, buildDocumentWithConsent(jsonlPaths, target, allowScripts, logBuildProgressToConsole, reconstructPreBaseline, bound));
        return;
    }

    // Progress stream: open it now so the pre-build work is visible. Headers are already out, so any
    // failure here is the terminal error line, not a 400 (a client-facing viewer request is always
    // progress=1; a bad project already 400'd above at requireParam). The final line is the same
    // object the non-progress path sends — the client keys off the `kind` discriminant.
    response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
    response.socket?.setNoDelay(true);   // sync build between writes — do not let Nagle batch the lines
    const writeNdjsonLine = (value: unknown): void => {
        // The synchronous build never yields to the event loop, so a client-abort 'close' event is
        // never delivered mid-build. Detection works anyway: the first write after the client's RST
        // fails synchronously inside net.Socket (uv_try_write EPIPE), which flips socket.writable to
        // false without needing the loop — `destroyed` stays false until the loop turns, so it is
        // the writable check that fires; the NEXT call here sees it and aborts the build.
        if (response.destroyed || response.socket === null || response.socket.destroyed || !response.socket.writable) {
            throw new Error("client disconnected — build cancelled");
        }
        response.write(JSON.stringify(value) + "\n");
        // res.write corks the socket and uncorks on nextTick — which never runs during the
        // synchronous build, so every line would sit buffered until the build ends. Uncork NOW
        // so each line flushes to the wire as it is written.
        response.socket?.uncork();
    };
    const reportStage = (label: string): void => {
        writeNdjsonLine({ kind: DocumentResponseKind.progress, label });
    };
    try {
        // task 56: same gate as the non-progress path, as the stream's terminal line.
        if (baselineQuestion !== undefined) {
            reportStage(`pre-baseline question required — base commit ${baselineQuestion.baseCommit}`);
            response.end(JSON.stringify(baselineQuestion) + "\n");
            return;
        }
        reportStage(`resolving transcript files for ${projectName}`);
        const jsonlPaths = resolveJsonlPaths(projectName, jsonlName);
        reportStage(`resolved ${jsonlPaths.length} transcript file(s)`);
        // This parse is the only one (the build below reuses these records from the cache), so
        // it streams the full per-record detail the console shows during a cold load.
        const { records } = loadProjectRecords(jsonlPaths, writeNdjsonLine);
        reportStage("scanning parsed records for recorded script executions");
        const decision = decideDocumentResponse(records, allowScripts);
        reportStage(decision.kind === DocumentResponseKind.consentRequired
            ? `consent required — ${decision.scripts.length} recorded script execution(s)`
            : "no script-execution consent needed");
        if (decision.kind === DocumentResponseKind.consentRequired && !declined) {
            response.end(JSON.stringify(decision) + "\n");
            return;
        }
        const document = buildDocumentWithConsent(jsonlPaths, target, allowScripts, (event) => {
            writeNdjsonLine(event);
            logBuildProgressToConsole(event);
        }, reconstructPreBaseline, bound);
        // The stringify below blocks the event loop for the whole document (seconds for a large
        // project); announce it FIRST so the client shows "serializing document" instead of
        // freezing on the last build line. The byte size is only known AFTER stringify, so the
        // transfer label follows it. (item 82)
        reportStage(PROGRESS_LABEL_SERIALIZING_DOCUMENT);
        const serialized = JSON.stringify(document);
        reportStage(formatSendingDocumentLabel(Buffer.byteLength(serialized)));
        response.end(serialized + "\n");
    } catch (error) {
        response.end(JSON.stringify({ kind: DocumentResponseKind.error, label: String(error) }) + "\n");
    }
}

// GET /api/diff — the revision-timeline or vs-base diff text for one file.
export function handleDiffRequest(response: ServerResponse, query: URLSearchParams): void {
    // item 46: const jsonlPaths = resolveJsonlPaths(requireParam(query, "project"), query.get("jsonl"));
    const projectName = requireParam(query, "project");
    applyProjectOverrides(projectName);
    const jsonlPaths = resolveJsonlPaths(projectName, query.get("jsonl"));
    const filePath = new Path(requireParam(query, "file"));
    const allowScripts = query.get("allowScripts") === "1";
    // task 56: no question gate here — the timeline already decided; the param only keeps
    // this request on the same cache entry as the document it is diffing.
    const reconstructPreBaseline = query.get("preBaseline") !== "0";
    // item 75: "Show full contents" — the revision-diff branch below widens git's context
    // to the whole file when the client asks for it.
    const fullContext = query.get("context") === "full";
    // Untargeted on purpose: both diff views send no jsonl param, so this reuses the very
    // project-wide artifact the views already built (equality certified by
    // test_revision_diff_from_untargeted_document_matches_targeted_build).
    const document = buildDocumentWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
    if (query.get("mode") === "vsbase") {
        sendText(response, 200, renderDiffVsBase(document, filePath, Number(query.get("rev") ?? "0")));
        return;
    }
    sendText(response, 200, renderRevisionDiff(document, filePath, fullContext));
}

// GET /api/range-patch — one git-apply-able unified diff for a picked contiguous step range over
// the WHOLE project's unified document. Consent mirrors /api/document's non-progress contract:
// consent-required is HTTP 200 with the kind discriminant (never a non-2xx), declined=1 builds
// the degraded document the client is already looking at.
export function handleRangePatchRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");
    applyProjectOverrides(projectName);   // item 46
    const { fromStep, toStep } = parseRangePatchQuery(query);
    const allowScripts = query.get("allowScripts") === "1";
    const reconstructPreBaseline = query.get("preBaseline") !== "0";   // task 56: cache-key agreement only
    const declined = query.get("declined") === "1";
    const jsonlPaths = resolveJsonlPaths(projectName, null);
    const { records } = loadProjectRecords(jsonlPaths);
    const decision = decideDocumentResponse(records, allowScripts);
    if (decision.kind === DocumentResponseKind.consentRequired && !declined) {
        sendJson(response, 200, decision);
        return;
    }
    const { document, stepFileHistories } = buildReconstructionWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
    sendText(response, 200, renderRangePatch(stepFileHistories, document.steps, fromStep, toStep));
}

// GET /api/step-files — the { path: content } map of every file present at one 1-based step, resolved
// on demand from the compact histories (skeleton steps carry no file map). One step's map is one repo
// snapshot — bounded, not multiplied. Consent mirrors /api/range-patch's non-progress contract.
export function handleStepFilesRequest(response: ServerResponse, query: URLSearchParams): void {
    const projectName = requireParam(query, "project");
    applyProjectOverrides(projectName);   // item 46
    const { step } = parseStepFilesQuery(query);
    const allowScripts = query.get("allowScripts") === "1";
    const reconstructPreBaseline = query.get("preBaseline") !== "0";   // task 56: cache-key agreement only
    const declined = query.get("declined") === "1";
    const jsonlPaths = resolveJsonlPaths(projectName, null);
    const { records } = loadProjectRecords(jsonlPaths);
    const decision = decideDocumentResponse(records, allowScripts);
    if (decision.kind === DocumentResponseKind.consentRequired && !declined) {
        sendJson(response, 200, decision);
        return;
    }
    const { document, stepFileHistories } = buildReconstructionWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
    sendJson(response, 200, resolveStepFiles(stepFileHistories, document.steps, step));
}
