// Thin HTTP wiring over viewer_api.ts — the localhost app (`npm run app`). Binds 127.0.0.1
// ONLY: this is a debugging surface for the user's own machine, never exposed. All logic lives
// in viewer_api.ts; this file only parses requests, dispatches, and serializes responses.

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

// A fresh stamp per process launch, handed to the client via GET /api/config: when it changes the
// client knows the server was relaunched and drops its remembered script-consent choices, which
// otherwise survive in the browser's per-tab sessionStorage. A launch nonce, so a plain string.
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

// Parse the flags USAGE lists: `--projects-dir` is MANDATORY (there is no default scan root),
// `--port` defaults to 7343, `--file-history-dir` to the item-46 derivation chain, and the two
// reset flags delete the disk sandbox memo / document cache (item 79) before load.
function parseServerArgs(argv: string[]): { port: number; resetSandboxMemo: boolean; resetDocumentCache: boolean } {
    const dirIndex = argv.indexOf("--projects-dir");
    if (dirIndex < 0 || argv[dirIndex + 1] === undefined) {
        throw new Error(USAGE);
    }
    setProjectsDir(argv[dirIndex + 1]!);
    // item 46: after --projects-dir, so an explicit dir survives the folder switch's reset.
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

// Serve `/`, `/webapp_old.html` (the pre-redesign page, task 204), and `/app/*` from
// webapp/dist/ then webapp/, refusing any resolved path outside those roots.
function serveStaticFile(response: ServerResponse, urlPath: string): void {
    const relative = computeStaticFileRelative(urlPath);
    const resolved = realpathSync(resolveStaticFilePath(relative, WEBAPP_DIST_DIR, WEBAPP_DIR));
    // dist lives inside webapp/, so the WEBAPP_DIR check covers both today; the explicit second
    // clause keeps a future dist relocation from silently opening a traversal hole.
    if (!resolved.startsWith(WEBAPP_DIR + sep) && !resolved.startsWith(WEBAPP_DIST_DIR + sep)) {
        sendText(response, 400, "path escapes webapp/");
        return;
    }
    const contentType = CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream";
    sendText(response, 200, readFileSync(resolved, "utf8"), contentType);
}

// POST /api/config — switch the scan root and/or the file-history root at runtime. Existence
// validation only: these are typed/pasted paths from the UI of a localhost app on the user's
// own machine. Order matters: the projects switch clears the file-history override (item 46's
// re-derive-on-switch), so an explicit fileHistoryDir in the SAME body is applied after it.
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

// GET /api/pick-folder — open a NATIVE macOS folder chooser (osascript) and return the choice.
// Task 236 asked for POST; a side-effect-free picker is a GET and app-header.ts already calls it that way.
// Cancel (or any osascript failure) is { path: "" } — the client no-ops on empty. The optional
// `current` param seeds the dialog's starting folder, but only when it exists on disk: a bad
// seed makes `default location` throw instead of showing the dialog.
// ponytail: spawnSync blocks the single-threaded server while the dialog is open — fine for a
// single-user localhost tool; switch to spawn+promise if a second concurrent user ever exists.
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
            // Handled by the Layer 1 group (viewer_server_layer1_routes.ts); nothing more to do.
        } else if (url.pathname === "/api/file-ladder") {
            handleFileLadderRequest(response, url.searchParams);
        } else if (url.pathname === "/api/document") {
            handleDocumentRequest(response, url.searchParams);
        } else if (url.pathname === "/api/raw") {
            serveRawTranscript(response, url.searchParams);
        } else if (url.pathname === "/api/blob") {
            // Always 200 + { exists, content } — the client branches on `exists`; a malformed
            // name throws into the outer catch (400) like every other trust-boundary refusal.
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
// Item 11: only the viewer app opts in to the disk-backed sandbox memo — restarts stop
// re-paying a spawn per distinct python run (CLI + tests stay memory-only).
const sandboxMemoPath = new Path(join(import.meta.dirname, "..", ".cache", "sandbox-memo.json"));
// --resetSandboxMemo: delete the memo BEFORE configuring persistence (which loads it), so this run
// starts empty and reconstructs everything from scratch — a forced cold load for measurement.
if (resetSandboxMemo) {
    resetSandboxMemoOnDisk(sandboxMemoPath);
}
configureSandboxMemoPersistence(sandboxMemoPath);
// Item 79: opt in to the disk-backed built-document cache so a respawn reads back the ~87 MB / 7.8 min
// reconstruction instead of rebuilding it (CLI + tests stay memory-only).
const documentCacheDir = new Path(join(import.meta.dirname, "..", ".cache", "built-documents"));
// --resetDocumentCache: delete the cache dir BEFORE configuring, for a forced cold rebuild.
if (resetDocumentCache) {
    resetDocumentCacheOnDisk(documentCacheDir);
}
configureDocumentCachePersistence(documentCacheDir);
const server = createServer(handleRequest);
// A cold non-streaming /api/document build can exceed Node's default ~300s request timeout,
// which closes the socket mid-build; the eventual sendJson then throws ERR_HTTP_HEADERS_SENT
// uncaught and kills the process. Localhost-only single-user server — no slow-client risk.
server.requestTimeout = 0;
server.listen(port, "127.0.0.1", () => {
    console.log(`viewer listening on http://127.0.0.1:${port} (projects: ${getProjectsDir()})`);
});

