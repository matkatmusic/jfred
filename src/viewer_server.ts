// HTTP wiring for the viewer. Binds 127.0.0.1 only: a local debugging surface, never exposed.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProjectsDir, getEffectiveFileHistoryDir } from "./viewer_api_projects.ts";
import { scanProjects } from "./viewer_api_project_scan.ts";
import { readBlobSnapshot, findProjectFile } from "./viewer_api_trust_boundary.ts";
import {
  sendJson,
  sendText,
  getRequiredParam,
  sendDocumentResponse,
  sendDiffResponse,
} from "./viewer_server_routes.ts";
import { sendRangePatchResponse, sendStepFilesResponse } from "./viewer_server_range_routes.ts";
import {
  sendRepoCommitMatchResponse,
  sendRepoCommitsResponse,
} from "./viewer_api_repo.ts";
import { dispatchProjectPathsRequest } from "./viewer_api_repo_paths.ts";
import { sendPrescanResponse } from "./viewer_api_prescan.ts";
import { sendLayeredGraphResponse } from "./viewer_api_layered.ts";
import { sendFileLadder } from "./viewer_api_ladder.ts";
import { dispatchLayer1Route } from "./viewer_server_layer1_routes.ts";
import { parseServerArgs } from "./viewer_server_args.ts";
import { SERVER_BOOT_ID, receiveConfigUpdate } from "./viewer_server_config.ts";
import { selectFolders } from "./viewer_server_folder_pick.ts";
import { sendStaticFile } from "./viewer_server_static.ts";
import { sendComponentSourceResponse } from "./viewer_server_component_source.ts";
import { setImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { setSandboxMemoPersistence, resetSandboxMemoOnDisk } from "./reconstruction_script_sandbox_memo.ts";
import { setRunResultStorePersistence } from "./layer1_run_result_store.ts";
import { setDocumentCachePersistence, resetDocumentCacheOnDisk } from "./reconstruction_document_cache.ts";
import { Path, Uuid } from "./structures/domain.ts";

function sendRawTranscript(response: ServerResponse, query: URLSearchParams): void {
  const jsonlPath = findProjectFile(
    getProjectsDir(), getRequiredParam(query, "project"), getRequiredParam(query, "jsonl"));
  sendText(response, 200, readFileSync(jsonlPath.toString(), "utf8"));
}

// Always 200 + { exists, content }: the client branches on `exists`.
function sendBlobResponse(response: ServerResponse, query: URLSearchParams): void {
  const session = new Uuid(getRequiredParam(query, "session"));
  const name = new Path(getRequiredParam(query, "name"));
  sendJson(response, 200, readBlobSnapshot(session, name));
}

type TailRoute = (response: ServerResponse, query: URLSearchParams) => void;

const TAIL_ROUTES = new Map<string, TailRoute>([
  ["/api/file-ladder", sendFileLadder],
  ["/api/document", sendDocumentResponse],
  ["/api/raw", sendRawTranscript],
  ["/api/blob", sendBlobResponse],
  ["/api/diff", sendDiffResponse],
  ["/api/range-patch", sendRangePatchResponse],
  ["/api/step-files", sendStepFilesResponse],
  ["/api/component-source", sendComponentSourceResponse],
]);

function dispatchTailRoute(response: ServerResponse, url: URL): void {
  const isStaticPath = url.pathname === "/" || url.pathname === "/webapp_old.html" || url.pathname.startsWith("/app/");
  const tailRoute = TAIL_ROUTES.get(url.pathname);
  if (tailRoute !== undefined) {
    tailRoute(response, url.searchParams);
  }
  else if (isStaticPath) {
    sendStaticFile(response, url.pathname);
  }
  else {
    sendText(response, 404, `no route: ${url.pathname}`);
  }
}

function sendConfigResponse(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "POST") {
    receiveConfigUpdate(request, response);
    return;
  }
  // item 46: sendJson(response, 200, { projectsDir: getProjectsDir() });
  sendJson(response, 200, { projectsDir: getProjectsDir(), fileHistoryDir: getEffectiveFileHistoryDir(), bootId: SERVER_BOOT_ID });
}

// Layer 1 routes sit before the tail routes; the dispatcher returns whether it owned the request.
function dispatchLayer1OrTailRoute(request: IncomingMessage, response: ServerResponse, url: URL): void {
  const isHandledByLayer1 = dispatchLayer1Route(request, response, url);
  if (!isHandledByLayer1) {
    dispatchTailRoute(response, url);
  }
}

type HeadRoute = (request: IncomingMessage, response: ServerResponse, url: URL) => void;

const HEAD_ROUTES = new Map<string, HeadRoute>([
  ["/api/config", (request, response) => sendConfigResponse(request, response)],
  ["/api/repo-commits", (_request, response, url) => sendRepoCommitsResponse(response, url.searchParams)],
  ["/api/repo-commit-match", (_request, response, url) => sendRepoCommitMatchResponse(response, url.searchParams)],
  ["/api/project-paths", (request, response, url) => dispatchProjectPathsRequest(request, response, url.searchParams)],
  ["/api/pick-folder", (_request, response, url) => selectFolders(response, url.searchParams)],
  ["/api/projects", (_request, response) => sendJson(response, 200, scanProjects(getProjectsDir()))],
  ["/api/prescan", (_request, response, url) => sendPrescanResponse(response, url.searchParams)],
  ["/api/layered-graph", (_request, response, url) => sendLayeredGraphResponse(response, url.searchParams)],
]);

function dispatchRequest(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const headRoute = HEAD_ROUTES.get(url.pathname) ?? dispatchLayer1OrTailRoute;
  try {
    headRoute(request, response, url);
  }
  catch (error) {
    sendText(response, 400, String(error));
  }
}

function logListening(): void {
  console.log(`viewer listening on http://127.0.0.1:${port} (projects: ${getProjectsDir()})`);
}

const { port, resetSandboxMemo, resetDocumentCache, sandboxMemoFile, runResultsFile } =parseServerArgs(process.argv.slice(2));
// App posture: impure stages OFF until a consented build turns them on for its own duration.
setImpureExecutionAllowed(false);
// Item 11: only the viewer opts into the disk memo, so restarts stop re-spawning python. CLI stays memory-only.
const sandboxMemoPath = new Path(sandboxMemoFile ?? join(import.meta.dirname, "..", ".cache", "sandbox-memo-docker.json"));
// Delete BEFORE configuring persistence, which loads it: a forced cold load for measurement.
if (resetSandboxMemo) {
  resetSandboxMemoOnDisk(sandboxMemoPath);
}
setSandboxMemoPersistence(sandboxMemoPath);
// Saved replay results survive a restart; the Clear button wipes this file.
setRunResultStorePersistence(new Path(runResultsFile ?? join(import.meta.dirname, "..", ".cache", "layer1-run-results.json")));
// Item 79: a respawn reads back the ~87 MB / 7.8 min reconstruction instead of rebuilding it.
const documentCacheDir = new Path(join(import.meta.dirname, "..", ".cache", "built-documents"));
// Delete the cache dir BEFORE configuring, for a forced cold rebuild.
if (resetDocumentCache) {
  resetDocumentCacheOnDisk(documentCacheDir);
}
setDocumentCachePersistence(documentCacheDir);
const server = createServer(dispatchRequest);
// A cold build can exceed Node's ~300s timeout, killing the process with ERR_HTTP_HEADERS_SENT.
server.requestTimeout = 0;
// Localhost-only: disable the 5s idle close whose FIN races undici's connection reuse into ECONNRESET.
server.keepAliveTimeout = 0;
server.listen(port, "127.0.0.1", logListening);
