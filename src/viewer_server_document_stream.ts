import { type ServerResponse } from "node:http";
import {
  buildDocumentWithConsent,
  PROGRESS_LABEL_SERIALIZING_DOCUMENT,
  formatSendingDocumentLabel,
} from "./viewer_api.ts";
import { decideDocumentResponse, type BaselineQuestion } from "./viewer_api_consent.ts";
import { findJsonlPaths } from "./viewer_api_sources.ts";
import { loadProjectRecords } from "./viewer_api_records.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
import type { ProgressSink } from "./parse/loadTranscript.ts";
import type { RevisionBoundRequest } from "./reconstruction_bound.ts";
import type { Path } from "./structures/domain.ts";

// Logs each build stage to stdout so tailing the server shows progress.
export const logBuildProgressToConsole: ProgressSink = (event) => {
  const counter = event.current === undefined ? "" : ` (${event.current}/${event.total})`;
  console.log(`   ${event.label}${counter}`);
};

export type DocumentStreamRequest = {
  projectName: string;
  jsonlName: string | null;
  allowScripts: boolean;
  declined: boolean;
  target: Path | undefined;
  bound: RevisionBoundRequest | undefined;
  reconstructPreBaseline: boolean;
  baselineQuestion: BaselineQuestion | undefined;
};

export function writeDocumentResponseStream(response: ServerResponse, request: DocumentStreamRequest): void {
  const { projectName, jsonlName, allowScripts, declined, target, bound, reconstructPreBaseline, baselineQuestion } = request;
  // Progress stream: headers go out now, so failures become the terminal error line, not a 400.
  response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
  response.socket?.setNoDelay(true);   // sync build between writes — do not let Nagle batch the lines
  const writeNdjsonLine = (value: unknown): void => {
    // Client aborts surface only as a failed write (socket.writable false); the next call throws to cancel the build.
    const { socket } = response;
    const isResponseDestroyed = response.destroyed;
    const isSocketMissing = socket === null;
    const isSocketDestroyed = socket?.destroyed === true;
    const isSocketUnwritable = socket?.writable !== true;
    const isResponseGone = isResponseDestroyed || isSocketMissing;
    const isSocketGone = isSocketDestroyed || isSocketUnwritable;
    const isClientGone = isResponseGone || isSocketGone;
    if (isClientGone) {
      throw new Error("client disconnected — build cancelled");
    }
    response.write(JSON.stringify(value) + "\n");
    // The build never yields, so uncork now: nextTick uncorking never runs mid-build.
    if (response.writableCorked > 0) {
      response.uncork();
    }
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
    const jsonlPaths = findJsonlPaths(projectName, jsonlName);
    reportStage(`resolved ${jsonlPaths.length} transcript file(s)`);
    // This parse is the only one; the build reuses its records from the cache.
    const { records } = loadProjectRecords(jsonlPaths, writeNdjsonLine);
    reportStage("scanning parsed records for recorded script executions");
    const decision = decideDocumentResponse(records, allowScripts);
    reportStage(decision.kind === DocumentResponseKind.consentRequired
      ? `consent required — ${decision.scripts.length} recorded script execution(s)`
      : "no script-execution consent needed");
    const isConsentRequired = decision.kind === DocumentResponseKind.consentRequired;
    const isNotDeclined = !declined;
    const isConsentNeeded = isConsentRequired && isNotDeclined;
    if (isConsentNeeded) {
      response.end(JSON.stringify(decision) + "\n");
      return;
    }
    const writeAndLogProgress: ProgressSink = (event) => {
      writeNdjsonLine(event);
      logBuildProgressToConsole(event);
    };
    const document = buildDocumentWithConsent(jsonlPaths, target, allowScripts, writeAndLogProgress, reconstructPreBaseline, bound);
    // Announce serializing first because stringify blocks the event loop; the byte size is known only after it. (item 82)
    reportStage(PROGRESS_LABEL_SERIALIZING_DOCUMENT);
    const serialized = JSON.stringify(document);
    reportStage(formatSendingDocumentLabel(Buffer.byteLength(serialized)));
    response.end(serialized + "\n");
  }
  catch (error) {
    response.end(JSON.stringify({ kind: DocumentResponseKind.error, label: String(error) }) + "\n");
  }
}
