// The viewer's JSONL-path resolution (spec S6, task 177): one named file, a whole project, or —
// for a project declaring `sources` — the union across every source's projects root. Split out
// of viewer_api_projects.ts (250-line cap); moved here from viewer_server_routes.ts (same cap).

import { Path } from "./structures/domain.ts";
import { hydrateProjectSources, type SourceEntry } from "./reconstruction_overrides.ts";
import {
    getMergedProjectPaths,
    getProjectsDir,
    resolveProjectFile,
    scanProjects,
    type ProjectListing,
} from "./viewer_api_projects.ts";

// One listing's JSONLs appended (de-duplicated by resolved path — a source may repeat the active projects dir), resolved through the same trust boundary as the active dir's files.
function appendListingJsonlPaths(
    projectsDir: Path,
    listing: ProjectListing,
    seenPaths: Set<string>,
    jsonlPaths: Path[],
): void {
    for (const entry of listing.jsonlFiles) {
        const resolved = resolveProjectFile(projectsDir, listing.name, entry.fileName.toString());
        if (seenPaths.has(resolved.toString())) {
            continue;
        }
        seenPaths.add(resolved.toString());
        jsonlPaths.push(resolved);
    }
}

// One source's project JSONLs: every listing under its projects root.
function collectOneSourceJsonlPaths(source: SourceEntry, seenPaths: Set<string>, jsonlPaths: Path[]): void {
    for (const listing of scanProjects(source.projectsDir)) {
        appendListingJsonlPaths(source.projectsDir, listing, seenPaths, jsonlPaths);
    }
}

// The resolved JSONL path(s) for a project: one named file, or every JSONL in the project (the unified view) when no file name is given. Spec S6: a project entry declaring `sources` serves the union of ALL sources' project JSONLs instead — the declared list is authoritative, so the config author lists every source including the primary (legacy entries keep the single-dir scan).
export function resolveJsonlPaths(projectName: string, jsonlName: string | null): Path[] {
    if (jsonlName !== null) {
        return [resolveProjectFile(getProjectsDir(), projectName, jsonlName)];
    }
    const wireEntry = getMergedProjectPaths(projectName);
    if (wireEntry.sources !== undefined) {
        const seenPaths = new Set<string>();
        const jsonlPaths: Path[] = [];
        for (const source of hydrateProjectSources(getProjectsDir(), wireEntry)) {
            collectOneSourceJsonlPaths(source, seenPaths, jsonlPaths);
        }
        return jsonlPaths;
    }
    const listing = scanProjects(getProjectsDir()).find((project) => project.name === projectName);
    if (listing === undefined) {
        throw new Error(`no project named ${projectName}`);
    }
    return listing.jsonlFiles.map((entry) =>
        resolveProjectFile(getProjectsDir(), projectName, entry.fileName.toString()),
    );
}
