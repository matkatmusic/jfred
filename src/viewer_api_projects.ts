// The viewer's projects-folder surface: scan the folder into listings, hold the runtime-
// switchable projects/file-history roots, and resolve request names at the trust boundary
// (project files, static assets, file-history blobs). The HTTP wiring lives in viewer_server.ts.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
    deriveSiblingFileHistoryRoot,
    getDefaultFileHistoryRoot,
} from "./reconstruction_sidecar_reader.ts";
import {
    hydrateProjectPaths,
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

// The synthetic project holding .jsonl files that sit directly in the scanned folder (an
// alternate folder that isn't .claude/projects-shaped), so any folder of JSONLs is loadable.
export const ROOT_PROJECT_NAME = "(root)";

// The app's runtime-switchable scan root (POST /api/config swaps it). There is NO default:
// the server refuses to start without --projects-dir, so reading it while unset is a bug.
// item 46: let activeProjectsDir = new Path(join(homedir(), ".claude", "projects"));
let activeProjectsDir: Path | undefined;

export function getProjectsDir(): Path {
    if (activeProjectsDir === undefined) {
        throw new Error("projects dir not set: start the server with --projects-dir <path>");
    }
    return activeProjectsDir;
}

// Switch the active scan root. Validation is existence-only, by design: this is a typed/pasted
// path in a localhost app on the user's own machine — the trust boundary is existence, not
// authorization. Throws (server maps to 400) and leaves the active dir unchanged on a bad path.
export function setProjectsDir(requested: string): Path {
    if (!statSync(requested, { throwIfNoEntry: false })?.isDirectory()) {
        throw new Error(`not a directory: ${requested}`);
    }
    activeProjectsDir = new Path(resolve(requested));
    // item 46: a folder switch re-derives the file-history root — exactly the webapp's
    // prepopulate behavior (the response echoes the newly effective dir into the field).
    activeFileHistoryDir = undefined;
    return activeProjectsDir;
}

// item 46: the folder-level file-history override (POST /api/config / --file-history-dir).
// undefined = derive from the projects folder.
let activeFileHistoryDir: Path | undefined;

// Switch the file-history root. The empty string clears the override so derivation follows
// the projects folder again; a non-directory throws (server maps to 400) and leaves the
// override unchanged. Returns the new EFFECTIVE dir (what the webapp shows in its field).
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

// The file-history root the viewer serves and shows: explicit override → the file-history/
// sibling of the projects folder → the ~/.claude default (item 46's resolution chain).
export function getEffectiveFileHistoryDir(): Path {
    return activeFileHistoryDir
        ?? (activeProjectsDir === undefined ? undefined : deriveSiblingFileHistoryRoot(activeProjectsDir))
        ?? getDefaultFileHistoryRoot();
}

// task 137: per-project overrides applied for this server session only (the "apply without
// storing" path). Setting an entry REPLACES the project's previous session entry — the client
// posts the full field set each time, and {} clears it.
const sessionProjectPaths = new Map<string, WireProjectPaths>();

export function setSessionProjectPaths(projectName: string, entry: WireProjectPaths): void {
    sessionProjectPaths.set(projectName, entry);
}

// The project's effective wire entry: the stored reveng-paths.json entry with the session
// entry's fields merged over it (a session field wins over the same stored field).
export function getMergedProjectPaths(projectName: string): WireProjectPaths {
    return { ...readProjectPathsConfig(getProjectsDir())[projectName], ...sessionProjectPaths.get(projectName) };
}

// item 46: set the engine's path overrides for this request — the project's merged entry
// (stored config + task-137 session overrides) plus the viewer's effective file-history dir
// when the entry sets none. Every project-scoped route calls this BEFORE any build work;
// overrides are process-wide module state, so each request overwrites the previous request's
// (builds are synchronous and the server serializes them).
export function applyProjectOverrides(projectName: string): void {
    const overrides = hydrateProjectPaths(getMergedProjectPaths(projectName));
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

// Scan a projects folder (each subdirectory = one project; loose .jsonl files = the synthetic
// "(root)" project) into listings sorted by most recent activity.
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

// The on-disk file for a static request: the compiled webapp/dist copy when the build emitted
// one (transpiled .js), else the webapp/ source (index.html, styles.css, vendor/*.js). The
// server realpath+prefix-checks the result before reading it.
export function resolveStaticFilePath(relative: string, distDir: string, webappDir: string): string {
    const compiledCandidate = resolve(distDir, relative);
    if (existsSync(compiledCandidate)) {
        return compiledCandidate;
    }
    return resolve(webappDir, relative);
}

// Trust boundary for the HTTP layer: `project` and `jsonl` arrive as NAMES, never paths.
// Resolve them against the projects dir and verify the resolved REAL path is still under it;
// anything escaping (traversal, absolute names, symlink tricks) is a loud error the server maps
// to 400. A nonexistent file throws here too (realpath), which is equally a refusal.
export function resolveProjectFile(projectsDir: Path, projectName: string, fileName: string): Path {
    const base = realpathSync(projectsDir.toString());
    const projectDir = projectName === ROOT_PROJECT_NAME ? base : resolve(base, projectName);
    const resolved = realpathSync(resolve(projectDir, fileName));
    if (!resolved.startsWith(base + sep)) {
        throw new Error(`refusing to resolve outside the projects dir: ${projectName}/${fileName}`);
    }
    return new Path(resolved);
}

// The exact shapes a blob-snapshot read accepts — both values reach a filesystem join, so this
// is a trust boundary: a blob name is `<16 hex>@vN` and a session id is hex-and-dashes only.
// Neither pattern admits `/`, `\`, or `.`, so traversal is impossible.
const BLOB_NAME_PATTERN = /^[0-9a-f]{16}@v\d+$/;
const SESSION_ID_PATTERN = /^[0-9a-fA-F-]+$/;

// One file-history blob for the inspector's snapshot drawer: whether
// <file-history root>/<sessionId>/<blobName> exists, and its verbatim content when it does.
// Owner-session dir ONLY — no cross-session fallback (owner-keyed reads are the multi-session
// @vN collision fix; probing other sessions' dirs would reintroduce wrong-content risk).
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
