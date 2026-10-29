import { type ServerResponse } from "node:http";
import { buildDocumentWithConsent } from "./viewer_api.ts";
import { logBuildProgressToConsole, writeDocumentResponseStream } from "./viewer_server_document_stream.ts";
import { computeBaselineQuestion, computeDocumentDecision } from "./viewer_api_consent.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { findJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { renderRevisionDiff, renderDiffVsBase } from "./viewer_api_diffs.ts";
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

export function getRequiredParam(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  if (value === null) {
    throw new Error(`missing query param: ${name}`);
  }
  return value;
}

// GET /api/document: returns the built document or streams NDJSON progress.
export function sendDocumentResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectName = getRequiredParam(query, "project");   // a missing project still returns 400 before any header
  const jsonlName = query.get("jsonl");
  const allowScripts = query.get("allowScripts") === "1";
  // task 56: "1"/"0" is the pre-baseline answer; null means not asked yet.
  const preBaselineChoice = query.get("preBaseline");
  const reconstructPreBaseline = preBaselineChoice !== "0";
  const targetValue = query.get("target");
  const target = targetValue === null ? undefined : new Path(targetValue);
  // declined=1 means the client chose Continue without running: build degraded.
  const declined = query.get("declined") === "1";
  // task 194: bounded mode stops at the Nth revision of boundFile.
  const boundFileValue = query.get("boundFile");
  const bound = boundFileValue === null
    ? undefined
    : { file: new Path(boundFileValue), ordinal: Number(query.get("boundNth") ?? "1") };
  // item 46: project overrides apply to all code below, before any header.
  applyProjectOverrides(projectName);
  // task 56: a configured base commit needs the user's answer before any scan.
  const baselineQuestion = computeBaselineQuestion(preBaselineChoice !== null);

  // Non-progress path: refusals return 400; consent-required is HTTP 200 with a kind field.
  const isProgressRequest = query.get("progress") === "1";
  if (!isProgressRequest) {
    if (baselineQuestion !== undefined) {
      sendJson(response, 200, baselineQuestion);
      return;
    }
    const jsonlPaths = findJsonlPaths(projectName, jsonlName);
    const { records } = loadProjectRecords(jsonlPaths);
    const decision = computeDocumentDecision(records, allowScripts);
    const isConsentRequired = decision.kind === DocumentResponseKind.consentRequired;
    const needsConsentReply = isConsentRequired && !declined;
    if (needsConsentReply) {
      sendJson(response, 200, decision);
      return;
    }
    sendJson(response, 200, buildDocumentWithConsent(jsonlPaths, target, allowScripts, logBuildProgressToConsole, reconstructPreBaseline, bound));
    return;
  }

  writeDocumentResponseStream(response, { projectName, jsonlName, allowScripts, declined, target, bound, reconstructPreBaseline, baselineQuestion });
}

// GET /api/diff: the revision-timeline or vs-base diff text for one file.
export function sendDiffResponse(response: ServerResponse, query: URLSearchParams): void {
  // item 46: const jsonlPaths = findJsonlPaths(getRequiredParam(query, "project"), query.get("jsonl"));
  const projectName = getRequiredParam(query, "project");
  applyProjectOverrides(projectName);
  const jsonlPaths = findJsonlPaths(projectName, query.get("jsonl"));
  const filePath = new Path(getRequiredParam(query, "file"));
  const allowScripts = query.get("allowScripts") === "1";
  // task 56: no question gate here; the param keeps this request on the document's cache entry.
  const reconstructPreBaseline = query.get("preBaseline") !== "0";
  // item 75: full context widens git's diff context to the whole file.
  const fullContext = query.get("context") === "full";
  // Untargeted on purpose: reuses the project-wide artifact both diff views already built.
  const document = buildDocumentWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
  const isVsBaseMode = query.get("mode") === "vsbase";
  if (isVsBaseMode) {
    sendText(response, 200, renderDiffVsBase(document, filePath, Number(query.get("rev") ?? "0")));
    return;
  }
  sendText(response, 200, renderRevisionDiff(document, filePath, fullContext));
}
