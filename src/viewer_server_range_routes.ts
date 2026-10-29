import { type ServerResponse } from "node:http";
import { buildReconstructionWithConsent } from "./viewer_api.ts";
import { logBuildProgressToConsole } from "./viewer_server_document_stream.ts";
import { computeDocumentDecision } from "./viewer_api_consent.ts";
import { applyProjectOverrides } from "./viewer_api_projects.ts";
import { findJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { renderRangePatch, parseRangePatchQuery, parseStepFilesQuery, computeStepFiles } from "./viewer_api_diffs.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import { getRequiredParam, sendJson, sendText } from "./viewer_server_routes.ts";

// GET /api/range-patch: git-apply-able diff for a step range; consent-required returns HTTP 200.
export function sendRangePatchResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectName = getRequiredParam(query, "project");
  applyProjectOverrides(projectName);   // item 46
  const { fromStep, toStep } = parseRangePatchQuery(query);
  const allowScripts = query.get("allowScripts") === "1";
  const reconstructPreBaseline = query.get("preBaseline") !== "0";   // task 56: cache-key agreement only
  const declined = query.get("declined") === "1";
  const jsonlPaths = findJsonlPaths(projectName, null);
  const { records } = loadProjectRecords(jsonlPaths);
  const decision = computeDocumentDecision(records, allowScripts);
  const isConsentRequired = decision.kind === DocumentResponseKind.consentRequired;
  const needsConsentReply = isConsentRequired && !declined;
  if (needsConsentReply) {
    sendJson(response, 200, decision);
    return;
  }
  const { document, stepFileHistories } = buildReconstructionWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
  sendText(response, 200, renderRangePatch(stepFileHistories, document.steps, fromStep, toStep));
}

// GET /api/step-files: the path-to-content map of files at one 1-based step; consent as range-patch.
export function sendStepFilesResponse(response: ServerResponse, query: URLSearchParams): void {
  const projectName = getRequiredParam(query, "project");
  applyProjectOverrides(projectName);   // item 46
  const { step } = parseStepFilesQuery(query);
  const allowScripts = query.get("allowScripts") === "1";
  const reconstructPreBaseline = query.get("preBaseline") !== "0";   // task 56: cache-key agreement only
  const declined = query.get("declined") === "1";
  const jsonlPaths = findJsonlPaths(projectName, null);
  const { records } = loadProjectRecords(jsonlPaths);
  const decision = computeDocumentDecision(records, allowScripts);
  const isConsentRequired = decision.kind === DocumentResponseKind.consentRequired;
  const needsConsentReply = isConsentRequired && !declined;
  if (needsConsentReply) {
    sendJson(response, 200, decision);
    return;
  }
  const { document, stepFileHistories } = buildReconstructionWithConsent(jsonlPaths, undefined, allowScripts, logBuildProgressToConsole, reconstructPreBaseline);
  sendJson(response, 200, computeStepFiles(stepFileHistories, document.steps, step));
}
