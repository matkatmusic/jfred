// Task 17 — Engine-B GitHub Pages demo generator. Runs the CURRENT engine's consented build
// over the s87 demo bundle and writes every response the webapp actually requests as static
// files under docs/engineb/, plus the static assembly of the page itself (webapp_old.html with
// its absolute /app/ asset URLs rewritten relative and the fetch shim injected). The shim
// (docs/engineb/static-shim.js) is authored source, never regenerated here.
//
// Run from the jfred repo root: `npx tsx scripts/generate_pages_demo_data.ts`
// (build webapp/dist first: `npm run build:webapp`).

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    applyProjectOverrides,
    getMergedProjectPaths,
    getProjectsDir,
    scanProjects,
    setFileHistoryDir,
    setProjectsDir,
} from "../src/viewer_api_projects.ts";
import { resolveJsonlPaths } from "../src/viewer_api_sources.ts";
import { loadProjectRecords } from "../src/viewer_api_records.ts";
import { buildDocumentWithConsent } from "../src/viewer_api.ts";
import { computeReconstructionPrescan } from "../src/viewer_api_prescan.ts";
import type { ProgressSink } from "./../src/parse/loadTranscript.ts";

const JFRED_ROOT = resolve(import.meta.dirname, "..");
const DEMO_PROJECT_NAME = "s87-demo-composite";
const DEMO_PROJECTS_DIR = join(JFRED_ROOT, "demo", "projects");
const DEMO_FILE_HISTORY_DIR = join(JFRED_ROOT, "demo", "file-history");
const OUTPUT_DIR = join(JFRED_ROOT, "docs", "engineb");
const DATA_DIR = join(OUTPUT_DIR, "data");
const APP_DIR = join(OUTPUT_DIR, "app");

// The /api/config bootId the shim's canned config carries. Fixed on purpose: the client drops
// its remembered consent choices when the bootId changes, and the static demo never changes.
const STATIC_DEMO_BOOT_ID = "engineb-static-demo";

const logGenerationProgress: ProgressSink = (event) => {
    const counter = event.current === undefined ? "" : ` (${event.current}/${event.total})`;
    console.log(`   ${event.label}${counter}`);
};

function writeJsonFile(filePath: string, value: unknown): void {
    writeFileSync(filePath, JSON.stringify(value) + "\n");
}

// Extract the demo repo exactly like `npm run demo` does — the git baseline lives in the tar so
// the published bundle carries no .git directory.
function extractDemoRepoTar(): void {
    console.log("extracting demo/repo.git.tar");
    execFileSync("tar", ["-xf", join(JFRED_ROOT, "demo", "repo.git.tar"), "-C", join(DEMO_PROJECTS_DIR, DEMO_PROJECT_NAME)]);
}

// Every canned /api/* response the webapp requests on the happy path. Interactive endpoints
// (/api/diff, /api/range-patch, /api/step-files, POST /api/config, /api/pick-folder,
// /api/repo-commits, /api/repo-commit-match) are NOT canned — the shim answers those with a
// marked "not available in the static demo" error and the UI's existing error paths surface it.
function generateCannedResponses(): void {
    rmSync(DATA_DIR, { recursive: true, force: true });
    mkdirSync(join(DATA_DIR, "raw"), { recursive: true });

    setProjectsDir(DEMO_PROJECTS_DIR);
    setFileHistoryDir(DEMO_FILE_HISTORY_DIR);
    applyProjectOverrides(DEMO_PROJECT_NAME);

    console.log("canning /api/config, /api/projects, /api/project-paths");
    writeJsonFile(join(DATA_DIR, "config.json"), {
        projectsDir: "demo/projects",
        fileHistoryDir: "demo/file-history",
        bootId: STATIC_DEMO_BOOT_ID,
    });
    writeJsonFile(join(DATA_DIR, "projects.json"), scanProjects(getProjectsDir()));
    writeJsonFile(join(DATA_DIR, "project-paths.json"), getMergedProjectPaths(DEMO_PROJECT_NAME));

    console.log("canning /api/raw (one file per session)");
    for (const entry of readdirSync(join(DEMO_PROJECTS_DIR, DEMO_PROJECT_NAME))) {
        if (entry.endsWith(".jsonl")) {
            cpSync(join(DEMO_PROJECTS_DIR, DEMO_PROJECT_NAME, entry), join(DATA_DIR, "raw", entry));
        }
    }

    console.log("canning /api/blob (the demo file-history tree, verbatim)");
    cpSync(DEMO_FILE_HISTORY_DIR, join(DATA_DIR, "blobs"), { recursive: true });

    const jsonlPaths = resolveJsonlPaths(DEMO_PROJECT_NAME, null);
    const { records } = loadProjectRecords(jsonlPaths);

    console.log("canning /api/prescan");
    writeJsonFile(join(DATA_DIR, "prescan.json"), { files: computeReconstructionPrescan(records) });

    console.log("canning /api/document (consented full build — this runs the engine)");
    const document = buildDocumentWithConsent(jsonlPaths, undefined, true, logGenerationProgress);
    // ONE line + trailing newline: the client's NDJSON reader only parses newline-terminated
    // lines, and the shim serves this file's bytes as the whole stream.
    writeJsonFile(join(DATA_DIR, "document.json"), document);
}

// Copy the compiled webapp and its static assets, and rewrite the page's absolute /app/ URLs to
// relative app/ ones (GitHub Pages serves under /jfred/, absolute paths 404). The shim script
// tag goes in as a CLASSIC script before the module script so the fetch patch runs first.
function assembleStaticWebapp(): void {
    console.log("assembling docs/engineb/ webapp copy");
    rmSync(APP_DIR, { recursive: true, force: true });
    cpSync(join(JFRED_ROOT, "webapp", "dist"), APP_DIR, { recursive: true });
    cpSync(join(JFRED_ROOT, "webapp", "styles.css"), join(APP_DIR, "styles.css"));
    cpSync(join(JFRED_ROOT, "webapp", "vendor"), join(APP_DIR, "vendor"), { recursive: true });

    const pageHtml = readFileSync(join(JFRED_ROOT, "webapp", "webapp_old.html"), "utf8")
        .replaceAll('"/app/', '"app/')
        .replace("<script type=\"module\"", "<script src=\"static-shim.js\"></script>\n    <script type=\"module\"");
    writeFileSync(join(OUTPUT_DIR, "webapp_old.html"), pageHtml);
}

extractDemoRepoTar();
generateCannedResponses();
assembleStaticWebapp();
console.log("done — verify with: python3 -m http.server -d docs  →  /engineb/webapp_old.html");
