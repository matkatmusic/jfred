// Projects-folder scanning, runtime root switching, and trust-boundary name resolution.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
    deriveSiblingFileHistoryRoot,
    getDefaultFileHistoryRoot,
} from "./reconstruction_sidecar_reader.ts";
import {
    hydrateProjectPaths,
    hydrateProjectSources,
    readProjectPathsConfig,
    setPathOverrides,
    type WireProjectPaths,
} from "./reconstruction_overrides.ts";
import { Path, Uuid } from "./structures/domain.ts";

export type JsonlFileEntry = {
    fileName: Path;
    sizeBytes: number;
    modifiedAt: Date;
};

export type ProjectListing = {
    name: string;
    jsonlFiles: JsonlFileEntry[];
};

// Synthetic project for loose .jsonl files sitting directly in the scanned folder.
export const ROOT_PROJECT_NAME = "(root)";

// The app's runtime-switchable scan root (POST /api/config swaps it). There is NO default: the server refuses to start without --projects-dir, so reading it while unset is a bug.  item 46: let activeProjectsDir = new Path(join(homedir(), ".claude", "projects"));
let activeProjectsDir: Path | undefined;

export function getProjectsDir(): Path {
    if (activeProjectsDir === undefined) {
        throw new Error("projects dir not set: start the server with --projects-dir <path>");
    }
    return activeProjectsDir;
}

// Existence-only validation; localhost trust boundary needs no authorization check.
export function setProjectsDir(requested: string): Path {
    if (!statSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`not a directory: ${requested}`);
    }
    activeProjectsDir = new Path(resolve(requested));
    // item 46: folder switch re-derives the file-history root (webapp prepopulate behavior).
    activeFileHistoryDir = undefined;
    return activeProjectsDir;
}

// item 46: the folder-level file-history override (POST /api/config / --file-history-dir).  undefined = derive from the projects folder.
let activeFileHistoryDir: Path | undefined;

// Empty string clears override; non-directory throws (400). Returns effective dir.
export function setFileHistoryDir(requested: string): Path {
    if (requested === "") {
        activeFileHistoryDir = undefined;
        return getEffectiveFileHistoryDir();
    }
    if (!statSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`not a directory: ${requested}`);
    }
    activeFileHistoryDir = new Path(resolve(requested));
    return activeFileHistoryDir;
}

// Resolution chain: explicit override, then sibling dir, then ~/.claude default.
export function getEffectiveFileHistoryDir(): Path {
    return activeFileHistoryDir
        ?? (activeProjectsDir === undefined ? undefined : deriveSiblingFileHistoryRoot(activeProjectsDir))
        ?? getDefaultFileHistoryRoot();
}

// task 137: session-only overrides; client posts full field set each time, {} clears.
const sessionProjectPaths = new Map<string, WireProjectPaths>();

export function setSessionProjectPaths(projectName: string, entry: WireProjectPaths): void {
    sessionProjectPaths.set(projectName, entry);
}

// Stored reveng-paths.json entry with session overrides merged on top.
export function getMergedProjectPaths(projectName: string): WireProjectPaths {
    return { ...readProjectPathsConfig(getProjectsDir())[projectName], ...sessionProjectPaths.get(projectName) };
}

// item 46: set the engine's path overrides for this request — the project's merged entry (stored config + task-137 session overrides) plus the viewer's effective file-history dir when the entry sets none. Every project-scoped route calls this BEFORE any build work; overrides are process-wide module state, so each request overwrites the previous request's (builds are synchronous and the server serializes them).
export function applyProjectOverrides(projectName: string): void {
    const wireEntry = getMergedProjectPaths(projectName);
    const overrides = hydrateProjectPaths(wireEntry);
    // Spec S6: multi-source record stream needs per-source blob resolution.
    if (wireEntry.sources !== undefined) {
        overrides.sources = hydrateProjectSources(getProjectsDir(), wireEntry);
    }
    if (overrides.fileHistoryRoot === undefined) {
        overrides.fileHistoryRoot = getEffectiveFileHistoryDir();
    }
    setPathOverrides(overrides);
}

// The .jsonl entries directly inside `dir`, newest first.
function listJsonlFiles(dir: string): JsonlFileEntry[] {
    const entries: JsonlFileEntry[] = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith(".jsonl")) continue;
        const stats = statSync(join(dir, name));
        if (!stats.isFile()) continue;
        entries.push({ fileName: new Path(name), sizeBytes: stats.size, modifiedAt: stats.mtime });
    }
    entries.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
    return entries;
}

// A project's most recent JSONL activity, for sorting; a JSONL-less project sorts last.
function computeLatestActivity(listing: ProjectListing): number {
    if (listing.jsonlFiles.length === 0) return 0;
    return listing.jsonlFiles[0]!.modifiedAt.getTime();
}

// Subdirectories become projects; loose .jsonl files become the "(root)" project.
export function scanProjects(projectsDir: Path): ProjectListing[] {
    const root = projectsDir.toString();
    const listings: ProjectListing[] = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        listings.push({ name: entry.name, jsonlFiles: listJsonlFiles(join(root, entry.name)) });
    }
    const looseJsonlFiles = listJsonlFiles(root);
    if (looseJsonlFiles.length > 0) {
        listings.push({ name: ROOT_PROJECT_NAME, jsonlFiles: looseJsonlFiles });
    }
    listings.sort((a, b) => computeLatestActivity(b) - computeLatestActivity(a));
    return listings;
}

// resolveJsonlPaths lives in viewer_api_sources.ts (task 177: 250-line cap split).

// `/` maps to index.html; `/app/*` prefixes strip to plain asset names.
export function computeStaticFileRelative(urlPath: string): string {
    if (urlPath === "/") {
        return "index.html";
    }
    return urlPath.replace(/^\/app\//, "").replace(/^\//, "");
}

// Prefer compiled webapp/dist copy; fall back to webapp/ source.
export function resolveStaticFilePath(relative: string, distDir: string, webappDir: string): string {
    const compiledCandidate = resolve(distDir, relative);
    if (existsSync(compiledCandidate)) {
        return compiledCandidate;
    }
    return resolve(webappDir, relative);
}

// Trust boundary for the HTTP layer: `project` and `jsonl` arrive as NAMES, never paths.  Resolve them against the projects dir and verify the resolved REAL path is still under it; anything escaping (traversal, absolute names, symlink tricks) is a loud error the server maps to 400. A nonexistent file throws here too (realpath), which is equally a refusal.
export function resolveProjectFile(projectsDir: Path, projectName: string, fileName: string): Path {
    const base = realpathSync(projectsDir.toString());
    const projectDir = projectName === ROOT_PROJECT_NAME ? base : resolve(base, projectName);
    const resolved = realpathSync(resolve(projectDir, fileName));
    if (!resolved.startsWith(base + sep)) {
        throw new Error(`refusing to resolve outside the projects dir: ${projectName}/${fileName}`);
    }
    return new Path(resolved);
}

// Trust boundary: patterns exclude `/`, `\`, `.` so traversal is impossible.
const BLOB_NAME_PATTERN = /^[0-9a-f]{16}@v\d+$/;
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]+$/;

// Owner-session dir only; no cross-session fallback (avoids @vN collision wrong-content risk).
export function readBlobSnapshot(sessionId: Uuid, blobName: Path): { exists: boolean; content: string | undefined } {
    if (!BLOB_NAME_PATTERN.test(blobName.toString())) {
        throw new Error(`not a backup blob name: ${blobName.toString()}`);
    }
    if (!SESSION_ID_PATTERN.test(sessionId.toString())) {
        throw new Error(`not a session id: ${sessionId.toString()}`);
    }
    // item 46: const blobPath = join(getDefaultFileHistoryRoot().toString(), sessionId.toString(), blobName.toString());
    const blobPath = join(getEffectiveFileHistoryDir().toString(), sessionId.toString(), blobName.toString());
    if (!existsSync(blobPath)) {
        return { exists: false, content: undefined };
    }
    return { exists: true, content: readFileSync(blobPath, "utf8") };
}
