// Thin HTTP wiring over viewer_api.ts. Binds 127.0.0.1 ONLY — a local debugging surface, never exposed.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import {
    scanProjects,
    readBlobSnapshot,
    resolveProjectFile,
    computeStaticFileRelative,
    resolveStaticFilePath,
    getProjectsDir,
    setProjectsDir,
    setFileHistoryDir,
    getEffectiveFileHistoryDir,
} from "./viewer_api_projects.ts";
import {
    sendJson,
    sendText,
    requireParam,
    handleDocumentRequest,
    handleDiffRequest,
    handleRangePatchRequest,
    handleStepFilesRequest,
} from "./viewer_server_routes.ts";
import {
    handleProjectPathsRequest,
    handleRepoCommitMatchRequest,
    handleRepoCommitsRequest,
} from "./viewer_api_repo.ts";
import { handlePrescanRequest } from "./viewer_api_prescan.ts";
import { handleLayeredGraphRequest } from "./viewer_api_layered.ts";
import { handleFileLadderRequest } from "./viewer_api_ladder.ts";
import { dispatchLayer1Route } from "./viewer_server_layer1_routes.ts";
import { setImpureExecutionAllowed } from "./reconstruction_exec_gate.ts";
import { configureSandboxMemoPersistence, resetSandboxMemoOnDisk } from "./reconstruction_script_sandbox.ts";
import { configureDocumentCachePersistence, resetDocumentCacheOnDisk } from "./reconstruction_document_cache.ts";
import { Path, Uuid } from "./structures/domain.ts";

const DEFAULT_PORT = 7343;

// A change tells the client the server relaunched, so it drops its stored script-consent choices.
const SERVER_BOOT_ID = randomUUID();
const WEBAPP_DIR = resolve(import.meta.dirname, "..", "webapp");
const WEBAPP_DIST_DIR = resolve(import.meta.dirname, "..", "webapp", "dist");

const CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
};

const USAGE = "usage: tsx src/viewer_server.ts --projects-dir <path> [--port <n>] [--file-history-dir <path>] [--resetSandboxMemo] [--resetDocumentCache]";

// `--projects-dir` is MANDATORY: there is no default scan root.
function parseServerArgs(argv: string[]): { port: number; resetSandboxMemo: boolean; resetDocumentCache: boolean } {
    const dirIndex = argv.indexOf("--projects-dir");
    if (dirIndex < 0 || argv[dirIndex + 1] === undefined) {
        throw new Error(USAGE);
    }
    setProjectsDir(argv[dirIndex + 1]!);
    // Item 46: after --projects-dir, so an explicit dir survives the folder switch's reset.
    const fileHistoryIndex = argv.indexOf("--file-history-dir");
    if (fileHistoryIndex >= 0 && argv[fileHistoryIndex + 1] !== undefined) {
        setFileHistoryDir(argv[fileHistoryIndex + 1]!);
    }
    const portIndex = argv.indexOf("--port");
    const port = portIndex >= 0 ? Number(argv[portIndex + 1]) : DEFAULT_PORT;
    if (!Number.isInteger(port)) {
        throw new Error(USAGE);
    }
    return {
        port,
        resetSandboxMemo: argv.includes("--resetSandboxMemo"),
        resetDocumentCache: argv.includes("--resetDocumentCache"),
    };
}

// Serves from webapp/dist/ then webapp/, refusing any resolved path outside those roots.
function serveStaticFile(response: ServerResponse, urlPath: string): void {
    const relative = computeStaticFileRelative(urlPath);
    const resolved = realpathSync(resolveStaticFilePath(relative, WEBAPP_DIST_DIR, WEBAPP_DIR));
    // The second clause is redundant today, but stops a future dist relocation opening a traversal hole.
    if (!resolved.startsWith(WEBAPP_DIR + sep) && !resolved.startsWith(WEBAPP_DIST_DIR + sep)) {
        sendText(response, 400, "path escapes webapp/");
        return;
    }
    const contentType = CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream";
    sendText(response, 200, readFileSync(resolved, "utf8"), contentType);
}

// Order matters: the projects switch clears the override, so an explicit fileHistoryDir applies after it.
function applyConfigUpdate(response: ServerResponse, body: string): void {
    const requested = JSON.parse(body) as { projectsDir?: string; fileHistoryDir?: string };
    if (requested.projectsDir === undefined && requested.fileHistoryDir === undefined) {
        sendJson(response, 400, { error: "body must carry projectsDir and/or fileHistoryDir" });
        return;
    }
    if (requested.projectsDir !== undefined) {
        setProjectsDir(requested.projectsDir);
    }
    if (requested.fileHistoryDir !== undefined) {
        setFileHistoryDir(requested.fileHistoryDir);
    }
    sendJson(response, 200, { projectsDir: getProjectsDir(), fileHistoryDir: getEffectiveFileHistoryDir(), bootId: SERVER_BOOT_ID });
}

function handleConfigUpdate(request: IncomingMessage, response: ServerResponse): void {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
        try {
            applyConfigUpdate(response, body);
        } catch (error) {
            sendJson(response, 400, { error: String(error) });
        }
    });
}

// GET /api/pick-folder — a native macOS osascript chooser; cancel or failure returns an empty path.

// `current` seeds the dialog only when it exists on disk, since a bad seed makes osascript throw.

// ponytail: spawnSync blocks the server while the dialog is open; use spawn+promise if concurrency appears.
function handleFolderPickRequest(response: ServerResponse, query: URLSearchParams): void {
    const current = query.get("current");
    const seed = current !== null && existsSync(current)
        ? ` default location (POSIX file ${JSON.stringify(current)})`
        : "";
    const result = spawnSync("osascript", [
        // The server is a background process — without activate the dialog opens behind the browser.
        "-e", 'tell application "System Events" to activate',
        "-e", `POSIX path of (choose folder with prompt "Select folder"${seed})`,
    ], { encoding: "utf8" });
    // Non-zero = user cancelled (-128) or osascript failed; both are "no pick" to the client.
    const picked = result.status === 0 ? result.stdout.trim().replace(/\/$/, "") : "";
    sendJson(response, 200, { path: picked });
}

function serveRawTranscript(response: ServerResponse, query: URLSearchParams): void {
    const jsonlPath = resolveProjectFile(
        getProjectsDir(), requireParam(query, "project"), requireParam(query, "jsonl"));
    sendText(response, 200, readFileSync(jsonlPath.toString(), "utf8"));
}

function handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    try {
        if (request.method === "POST" && url.pathname === "/api/config") {
            handleConfigUpdate(request, response);
        } else if (url.pathname === "/api/config") {
            // item 46: sendJson(response, 200, { projectsDir: getProjectsDir() });
            sendJson(response, 200, { projectsDir: getProjectsDir(), fileHistoryDir: getEffectiveFileHistoryDir(), bootId: SERVER_BOOT_ID });
        } else if (url.pathname === "/api/repo-commits") {
            handleRepoCommitsRequest(response, url.searchParams);
        } else if (url.pathname === "/api/repo-commit-match") {
            handleRepoCommitMatchRequest(response, url.searchParams);
        } else if (url.pathname === "/api/project-paths") {
            handleProjectPathsRequest(request, response, url.searchParams);
        } else if (url.pathname === "/api/pick-folder") {
            handleFolderPickRequest(response, url.searchParams);
        } else if (url.pathname === "/api/projects") {
            sendJson(response, 200, scanProjects(getProjectsDir()));
        } else if (url.pathname === "/api/prescan") {
            handlePrescanRequest(response, url.searchParams);
        } else if (url.pathname === "/api/layered-graph") {
            handleLayeredGraphRequest(response, url.searchParams);
        } else if (dispatchLayer1Route(request, response, url)) {
            // Handled by viewer_server_layer1_routes.ts.
        } else if (url.pathname === "/api/file-ladder") {
            handleFileLadderRequest(response, url.searchParams);
        } else if (url.pathname === "/api/document") {
            handleDocumentRequest(response, url.searchParams);
        } else if (url.pathname === "/api/raw") {
            serveRawTranscript(response, url.searchParams);
        } else if (url.pathname === "/api/blob") {
            // Always 200 + { exists, content }: the client branches on `exists`.
            const session = new Uuid(requireParam(url.searchParams, "session"));
            const name = new Path(requireParam(url.searchParams, "name"));
            sendJson(response, 200, readBlobSnapshot(session, name));
        } else if (url.pathname === "/api/diff") {
            handleDiffRequest(response, url.searchParams);
        } else if (url.pathname === "/api/range-patch") {
            handleRangePatchRequest(response, url.searchParams);
        } else if (url.pathname === "/api/step-files") {
            handleStepFilesRequest(response, url.searchParams);
        } else if (url.pathname === "/" || url.pathname === "/webapp_old.html" || url.pathname.startsWith("/app/")) {
            serveStaticFile(response, url.pathname);
        } else {
            sendText(response, 404, `no route: ${url.pathname}`);
        }
    } catch (error) {
        sendText(response, 400, String(error));
    }
}

const { port, resetSandboxMemo, resetDocumentCache } = parseServerArgs(process.argv.slice(2));
// App posture: impure stages OFF until a consented build turns them on for its own duration.
setImpureExecutionAllowed(false);
// Item 11: only the viewer opts into the disk memo, so restarts stop re-spawning python. CLI stays memory-only.
const sandboxMemoPath = new Path(join(import.meta.dirname, "..", ".cache", "sandbox-memo.json"));
// Delete BEFORE configuring persistence, which loads it — a forced cold load for measurement.
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
const server = createServer(handleRequest);
// A cold build can exceed Node's ~300s timeout, killing the process with ERR_HTTP_HEADERS_SENT.
server.requestTimeout = 0;
server.listen(port, "127.0.0.1", () => {
    console.log(`viewer listening on http://127.0.0.1:${port} (projects: ${getProjectsDir()})`);
});

