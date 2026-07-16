// User-supplied data-source path overrides (TASKS.md item 46): where the file-history
// blobs, the project, and its git repo live NOW, for transcripts copied out of ~/.claude
// (e.g. an audit tree mirroring the ~/.claude layout). Process-wide module state on the
// reconstruction_exec_gate.ts precedent — builds are synchronous and the server
// serializes them, so each request/run sets the state it needs. Empty state = every
// consumer behaves exactly as before item 46.
//
// The `projectCwd` override is consumed at the git-evidence DISK-ACCESS points, never
// rewritten into records at parse time: rewriting record.cwd while file paths stay
// recorded breaks readCommittedFileContent's relative-path math and puts rename/copy
// resolution (resolveAgainstCwd) in a mixed path space that breaks lineage joins
// (user-approved deviation from the item-46 text, 2026-07-09).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Path, Uuid } from "./structures/domain.ts";

// The four overrides. All optional; an absent field means "use today's default".
export type PathOverrides = {
    fileHistoryRoot?: Path;   // file-history blob root (chain: this → derived sibling → ~/.claude/file-history)
    projectCwd?: Path;        // where the project lives on disk NOW (extra git-evidence repo candidate)
    repoDir?: Path;           // the git repo to read committed blobs from (wins over the transcript-sibling clone)
    baseCommit?: Uuid;        // commit whose tree seeds tier-1 write beacons (requires repoDir)
};

let activePathOverrides: PathOverrides = {};

export function setPathOverrides(overrides: PathOverrides): void {
    activePathOverrides = overrides;
}

export function getPathOverrides(): PathOverrides {
    return activePathOverrides;
}

// Stable string for cache stamps: the defined fields in fixed key order (undefined
// fields drop out of JSON.stringify, so the empty state is always "{}").
export function serializePathOverrides(): string {
    const { fileHistoryRoot, projectCwd, repoDir, baseCommit } = activePathOverrides;
    return JSON.stringify({
        fileHistoryRoot: fileHistoryRoot?.toString(),
        projectCwd: projectCwd?.toString(),
        repoDir: repoDir?.toString(),
        baseCommit: baseCommit?.toString(),
    });
}

// The per-project config file sitting INSIDE the projects folder (scanProjects only
// lists directories and .jsonl files, so the config never shows up as a project).
export const PROJECT_PATHS_CONFIG_NAME = "reveng-paths.json";

// Wire shape of one project's entry in <projectsDir>/reveng-paths.json.
export type WireProjectPaths = { cwd?: string; repo?: string; baseCommit?: string };

// The whole config file: project dir name -> entry. {} when the file does not exist;
// malformed JSON throws (a typo must be loud, not a silently ignored override).
export function readProjectPathsConfig(projectsDir: Path): Record<string, WireProjectPaths> {
    const configPath = join(projectsDir.toString(), PROJECT_PATHS_CONFIG_NAME);
    if (!existsSync(configPath)) {
        return {};
    }
    return JSON.parse(readFileSync(configPath, "utf8")) as Record<string, WireProjectPaths>;
}

// Hydration point (coding-req §1: parsing hydrates, never casts): wire strings ->
// domain objects. Absent wire fields stay absent.
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
    return overrides;
}

