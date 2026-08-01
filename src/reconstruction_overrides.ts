// User-supplied data-source path overrides (TASKS.md item 46): where the file-history blobs, the project, and its git repo live NOW, for transcripts copied out of ~/.claude (e.g. an audit tree mirroring the ~/.claude layout). Process-wide module state on the reconstruction_exec_gate.ts precedent — builds are synchronous and the server serializes them, so each request/run sets the state it needs. Empty state = every consumer behaves exactly as before item 46.
//
// The `projectCwd` override is consumed at the git-evidence DISK-ACCESS points, never rewritten into records at parse time: rewriting record.cwd while file paths stay recorded breaks readCommittedFileContent's relative-path math and puts rename/copy resolution (resolveAgainstCwd) in a mixed path space that breaks lineage joins (user-approved deviation from the item-46 text, 2026-07-09).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";
import { discoverSourceEntriesForProjectRoot } from "./reconstruction_repo_discovery.ts";

// The overrides. All optional; an absent field means "use today's default".
export type PathOverrides = {
    fileHistoryRoot?: Path;   // file-history blob root (chain: this → derived sibling → ~/.claude/file-history)
    projectCwd?: Path;        // where the project lives on disk NOW (extra git-evidence repo candidate)
    repoDir?: Path;           // the git repo to read committed blobs from (wins over the transcript-sibling clone)
    baseCommit?: Uuid;        // commit whose tree seeds tier-1 write beacons (requires repoDir)
    sources?: SourceEntry[];  // the project's declared multi-source list (spec S4b/S6); absent = single-source
};

let activePathOverrides: PathOverrides = {};

export function setPathOverrides(overrides: PathOverrides): void {
    activePathOverrides = overrides;
}

export function getPathOverrides(): PathOverrides {
    return activePathOverrides;
}

// Stable string for cache stamps: the defined fields in fixed key order (undefined fields drop out of JSON.stringify, so the empty state is always "{}"). `sources` is in the stamp so a source-list config change never reuses a single-source cached document (spec S6).
export function serializePathOverrides(): string {
    const { fileHistoryRoot, projectCwd, repoDir, baseCommit, sources } = activePathOverrides;
    return JSON.stringify({
        fileHistoryRoot: fileHistoryRoot?.toString(),
        projectCwd: projectCwd?.toString(),
        repoDir: repoDir?.toString(),
        baseCommit: baseCommit?.toString(),
        sources: sources?.map((source) => ({
            projectsDir: source.projectsDir.toString(),
            fileHistoryDir: source.fileHistoryDir?.toString(),
            root: source.root?.toString(),
            repoDir: source.repoDir?.toString(),
            baseCommit: source.baseCommit?.toString(),
        })),
    });
}

// Per-project config file inside the projects folder; scanProjects ignores it since it lists only dirs and .jsonl files.
export const PROJECT_PATHS_CONFIG_NAME = "reveng-paths.json";

// Wire shape of one entry in a project's `sources` list (spec S3): one conversation-log folder plus its optional file-history folder and workspace root. Paths resolve exactly like every other reveng-paths.json path (task-56 trap: jfred-root-relative or absolute, taken verbatim).
export type WireSourceEntry = {
    projectsDir: string;
    fileHistoryDir?: string;
    root?: string;
    repoDir?: string;
    baseCommit?: string;
};

// Wire shape of one project's entry in <projectsDir>/reveng-paths.json. fileHistory is the per-project explicit file-history-snapshots override (task 137); sources is the multi-source list (spec S3).
export type WireProjectPaths = {
    cwd?: string;
    repo?: string;
    baseCommit?: string;
    fileHistory?: string;
    sources?: WireSourceEntry[];
    // task 159: the wizard screen-5 pre-baseline answer ("1" reconstruct / "0" start at the baseline), persisted on Store; the webapp seeds its task-56 sessionStorage mirror from it.
    preBaseline?: string;
};

// One hydrated source (spec S3/S4): where a source's JSONLs live, optionally where its file-history blobs live, and optionally the workspace root its file paths are relative to. An absent root means "auto-detect from JSONL cwds" (design §b) — resolved by later pipeline stages, never at parse time.
export type SourceEntry = {
    projectsDir: Path;
    fileHistoryDir?: Path;
    root?: Path;
    repoDir?: Path;   // task 365: the nested repo this source's git evidence resolves against
    baseCommit?: Uuid; // task 365: the tier-1 beacon commit for repoDir, per-source
};

// A project's sources list (spec S3); task 365: nested-repo auto-discovery wins over the legacy single-source fallback.
export function hydrateProjectSources(configProjectsDir: Path, wire: WireProjectPaths): SourceEntry[] {
    if (wire.sources === undefined) {
        if (wire.cwd !== undefined) {
            const discoveredSources = discoverSourceEntriesForProjectRoot(new Path(wire.cwd));
            if (discoveredSources.length > 0) {
                return discoveredSources;
            }
        }
        const legacySource: SourceEntry = { projectsDir: configProjectsDir };
        if (wire.fileHistory !== undefined) {
            legacySource.fileHistoryDir = new Path(wire.fileHistory);
        }
        return [legacySource];
    }
    const sourceEntries: SourceEntry[] = [];
    for (const wireSource of wire.sources) {
        const sourceEntry: SourceEntry = { projectsDir: new Path(wireSource.projectsDir) };
        if (wireSource.fileHistoryDir !== undefined) {
            sourceEntry.fileHistoryDir = new Path(wireSource.fileHistoryDir);
        }
        if (wireSource.root !== undefined) {
            sourceEntry.root = new Path(wireSource.root);
        }
        if (wireSource.repoDir !== undefined) {
            sourceEntry.repoDir = new Path(wireSource.repoDir);
        }
        if (wireSource.baseCommit !== undefined) {
            sourceEntry.baseCommit = new Uuid(wireSource.baseCommit);
        }
        sourceEntries.push(sourceEntry);
    }
    return sourceEntries;
}

// Project dir name -> entry map; {} if missing, malformed JSON throws so typos are never silently ignored.
export function readProjectPathsConfig(projectsDir: Path): Record<string, WireProjectPaths> {
    const configPath = join(projectsDir.toString(), PROJECT_PATHS_CONFIG_NAME);
    if (!existsSync(configPath)) {
        return {};
    }
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, WireProjectPaths>;
}

// Hydration point (coding-req §1: parsing hydrates, never casts): wire strings -> domain objects. Absent wire fields stay absent.
export function hydrateProjectPaths(wire: WireProjectPaths): PathOverrides {
    const overrides: PathOverrides = {};
    if (wire.cwd !== undefined) {
        overrides.projectCwd = new Path(wire.cwd);
    }
    if (wire.repo !== undefined) {
        overrides.repoDir = new Path(wire.repo);
    }
    if (wire.baseCommit !== undefined) {
        overrides.baseCommit = new Uuid(wire.baseCommit);
    }
    if (wire.fileHistory !== undefined) {
        overrides.fileHistoryRoot = new Path(wire.fileHistory);
    }
    return overrides;
}

// Merge one project's entry into <projectsDir>/reveng-paths.json (task 137's opt-in store).  Field-wise merge: fields absent from `entry` keep their stored values.
export function writeProjectPathsEntry(projectsDir: Path, projectName: string, entry: WireProjectPaths): void {
    const config = readProjectPathsConfig(projectsDir);
    config[projectName] = { ...config[projectName], ...entry };
    writeFileSync(join(projectsDir.toString(), PROJECT_PATHS_CONFIG_NAME), JSON.stringify(config, null, 4) + "\n");
}

