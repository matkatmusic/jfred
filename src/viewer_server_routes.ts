import { type ServerResponse } from "node:http";
import { buildDocumentWithConsent, buildReconstructionWithConsent } from "./viewer_api.ts";
import { logBuildProgressToConsole, streamDocumentResponse } from "./viewer_server_document_stream.ts";
import { decideBaselineQuestion, decideDocumentResponse } from "./viewer_api_consent.ts";
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
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
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

// GET /api/document — returns built document or streams NDJSON progress.
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
  // task 194: bounded mode — stop at boundFile's Nth revision.
  const boundFileValue = query.get("boundFile");
  const bound = boundFileValue === null
    ? undefined
    : { file: new Path(boundFileValue), ordinal: Number(query.get("boundNth") ?? "1") };
  // item 46: project path overrides apply to everything below; runs before any header so a malformed reveng-paths.json still 400s.
  applyProjectOverrides(projectName);
  // task 56: a configured base commit needs the user's answer BEFORE any consent scan or build.
  const baselineQuestion = decideBaselineQuestion(preBaselineChoice !== null);

  // Non-progress path: decide before any header so refusals return 400; consent-required is HTTP 200 with a kind field.
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

  streamDocumentResponse(response, { projectName, jsonlName, allowScripts, declined, target, bound, reconstructPreBaseline, baselineQuestion });
}

// GET /api/diff — the revision-timeline or vs-base diff text for one file.
export function handleDiffRequest(response: ServerResponse, query: URLSearchParams): void {
  // item 46: const jsonlPaths = resolveJsonlPaths(requireParam(query, "project"), query.get("jsonl"));
  const projectName = requireParam(query, "project");
  applyProjectOverrides(projectName);
  const jsonlPaths = resolveJsonlPaths(projectName, query.get("jsonl"));
  const filePath = new Path(requireParam(query, "file"));
  const allowScripts = query.get("allowScripts") === "1";
  // task 56: no question gate here; the param only keeps this request on the document's cache entry.
  const reconstructPreBaseline = query.get("preBaseline") !== "0";
  // item 75: client-requested full context widens git's diff context to the whole file.
  const fullContext = query.get("context") === "full";
  // Untargeted on purpose: reuses the project-wide artifact both diff views already built (certified by test_revision_diff_from_untargeted_document_matches_targeted_build).
  const document = buildDocumentWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
  if (query.get("mode") === "vsbase") {
    sendText(response, 200, renderDiffVsBase(document, filePath, Number(query.get("rev") ?? "0")));
    return;
  }
  sendText(response, 200, renderRevisionDiff(document, filePath, fullContext));
}

// GET /api/range-patch — one git-apply-able unified diff for a picked contiguous step range over the WHOLE project's unified document. Consent mirrors /api/document's non-progress contract: consent-required is HTTP 200 with the kind discriminant (never a non-2xx), declined=1 builds the degraded document the client is already looking at.
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

// GET /api/step-files — the { path: content } map of every file present at one 1-based step, resolved on demand from the compact histories (skeleton steps carry no file map). One step's map is one repo snapshot — bounded, not multiplied. Consent mirrors /api/range-patch's non-progress contract.
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

