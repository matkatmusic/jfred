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
import { setImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { configureSandboxMemoPersistence, resetSandboxMemoOnDisk } from "./reconstruction_script_sandbox.ts";
import { configureDocumentCachePersistence, resetDocumentCacheOnDisk } from "./reconstruction_document_cache.ts";
import { Path, Uuid } from "./structures/domain.ts";

function sendRawTranscript(response: ServerResponse, query: URLSearchParams): void {
  const jsonlPath = findProjectFile(
    getProjectsDir(), getRequiredParam(query, "project"), getRequiredParam(query, "jsonl"));
  sendText(response, 200, readFileSync(jsonlPath.toString(), "utf8"));
}

function dispatchTailRoute(response: ServerResponse, url: URL): void {
  const isStaticPath = url.pathname === "/" || url.pathname === "/webapp_old.html" || url.pathname.startsWith("/app/");
  if (url.pathname === "/api/file-ladder") {
    sendFileLadder(response, url.searchParams);
  }
  else if (url.pathname === "/api/document") {
    sendDocumentResponse(response, url.searchParams);
  }
  else if (url.pathname === "/api/raw") {
    sendRawTranscript(response, url.searchParams);
  }
  else if (url.pathname === "/api/blob") {
    // Always 200 + { exists, content }: the client branches on `exists`.
    const session = new Uuid(getRequiredParam(url.searchParams, "session"));
    const name = new Path(getRequiredParam(url.searchParams, "name"));
    sendJson(response, 200, readBlobSnapshot(session, name));
  }
  else if (url.pathname === "/api/diff") {
    sendDiffResponse(response, url.searchParams);
  }
  else if (url.pathname === "/api/range-patch") {
    sendRangePatchResponse(response, url.searchParams);
  }
  else if (url.pathname === "/api/step-files") {
    sendStepFilesResponse(response, url.searchParams);
  }
  else if (isStaticPath) {
    sendStaticFile(response, url.pathname);
  }
  else {
    sendText(response, 404, `no route: ${url.pathname}`);
  }
}

function dispatchRequest(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const isConfigPost = request.method === "POST" && url.pathname === "/api/config";
  try {
    if (isConfigPost) {
      receiveConfigUpdate(request, response);
    }
    else if (url.pathname === "/api/config") {
      // item 46: sendJson(response, 200, { projectsDir: getProjectsDir() });
      sendJson(response, 200, { projectsDir: getProjectsDir(), fileHistoryDir: getEffectiveFileHistoryDir(), bootId: SERVER_BOOT_ID });
    }
    else if (url.pathname === "/api/repo-commits") {
      sendRepoCommitsResponse(response, url.searchParams);
    }
    else if (url.pathname === "/api/repo-commit-match") {
      sendRepoCommitMatchResponse(response, url.searchParams);
    }
    else if (url.pathname === "/api/project-paths") {
      dispatchProjectPathsRequest(request, response, url.searchParams);
    }
    else if (url.pathname === "/api/pick-folder") {
      selectFolders(response, url.searchParams);
    }
    else if (url.pathname === "/api/projects") {
      sendJson(response, 200, scanProjects(getProjectsDir()));
    }
    else if (url.pathname === "/api/prescan") {
      sendPrescanResponse(response, url.searchParams);
    }
    else if (url.pathname === "/api/layered-graph") {
      sendLayeredGraphResponse(response, url.searchParams);
    }
    else {
      // Layer 1 routes sit before the tail routes; the dispatcher returns whether it owned the request.
      const isHandledByLayer1 = dispatchLayer1Route(request, response, url);
      if (!isHandledByLayer1) {
        dispatchTailRoute(response, url);
      }
    }
  }
  catch (error) {
    sendText(response, 400, String(error));
  }
}

function logListening(): void {
  console.log(`viewer listening on http://127.0.0.1:${port} (projects: ${getProjectsDir()})`);
}

const { port, resetSandboxMemo, resetDocumentCache } = parseServerArgs(process.argv.slice(2));
// App posture: impure stages OFF until a consented build turns them on for its own duration.
setImpureExecutionAllowed(false);
// Item 11: only the viewer opts into the disk memo, so restarts stop re-spawning python. CLI stays memory-only.
const sandboxMemoPath = new Path(join(import.meta.dirname, "..", ".cache", "sandbox-memo.json"));
// Delete BEFORE configuring persistence, which loads it: a forced cold load for measurement.
if (resetSandboxMemo) {
  resetSandboxMemoOnDisk(sandboxMemoPath);
}
configureSandboxMemoPersistence(sandboxMemoPath);
// Item 79: a respawn reads back the ~87 MB / 7.8 min reconstruction instead of rebuilding it.
const documentCacheDir = new Path(join(import.meta.dirname, "..", ".cache", "built-documents"));
// Delete the cache dir BEFORE configuring, for a forced cold rebuild.
if (resetDocumentCache) {
  resetDocumentCacheOnDisk(documentCacheDir);
}
configureDocumentCachePersistence(documentCacheDir);
const server = createServer(dispatchRequest);
// A cold build can exceed Node's ~300s timeout, killing the process with ERR_HTTP_HEADERS_SENT.
server.requestTimeout = 0;
// Localhost-only: disable the 5s idle close whose FIN races undici's connection reuse into ECONNRESET.
server.keepAliveTimeout = 0;
server.listen(port, "127.0.0.1", logListening);
