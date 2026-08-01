// Nested-repo discovery (task 365): finds nested git repos under a non-repo project root, feeding hydrateProjectSources's SourceEntry auto-population.

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";
import type { SourceEntry } from "./reconstruction_overrides.ts";

// Vendor trees and git's own internals are never worth descending into.
const SKIPPED_DIR_NAMES = new Set([".git", "node_modules"]);

// Every directory at or below rootDir (including itself) that is a git repo (has a .git entry, dir or file). Depth-first, sorted per-directory for deterministic ordering.
export function discoverNestedRepos(rootDir: Path): Path[] {
    const found: Path[] = [];
    walkForGitRepos(rootDir.toString(), found);
    return found;
}

function walkForGitRepos(dir: string, found: Path[]): void {
    if (existsSync(join(dir, ".git"))) {
        found.push(new Path(dir));
    }
    const subdirNames = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((name) => !SKIPPED_DIR_NAMES.has(name))
        .sort();
    for (const subdirName of subdirNames) {
        walkForGitRepos(join(dir, subdirName), found);
    }
}

// Claude Code's own project-folder name for a working directory: every non-alphanumeric character becomes "-" (mirrors webapp/layer1-source-paths.ts's encodeProjectFolderName — webapp cannot import from src/, so the verified formula is duplicated here rather than shared).
function encodeProjectFolderName(projectFolder: string): string {
    return projectFolder.replace(/[^a-zA-Z0-9]/g, "-");
}

// Auto-populate a project's sources[] from its nested repos: a project whose configured cwd is not itself a repo, but contains nested repos each with a recorded Claude Code session at their own root, gets one SourceEntry per such nested repo. Empty when the cwd IS itself a repo (legacy single-source path — zero behavior change, the common case) or when no discovered repo has any matching recorded session.
export function discoverSourceEntriesForProjectRoot(projectCwd: Path): SourceEntry[] {
    if (existsSync(join(projectCwd.toString(), ".git"))) {
        return [];
    }
    const nestedRepos = discoverNestedRepos(projectCwd);
    if (nestedRepos.length === 0) {
        return [];
    }
    const claudeProjectsRoot = join(homedir(), ".claude", "projects");
    const sourceEntries: SourceEntry[] = [];
    for (const repoDir of nestedRepos) {
        const mangledProjectsDir = join(claudeProjectsRoot, encodeProjectFolderName(repoDir.toString()));
        if (!existsSync(mangledProjectsDir)) {
            continue;
        }
        const hasRecordedSession = readdirSync(mangledProjectsDir).some((name) => name.endsWith(".jsonl"));
        if (!hasRecordedSession) {
            continue;
        }
        sourceEntries.push({ projectsDir: new Path(mangledProjectsDir), root: repoDir, repoDir });
    }
    return sourceEntries;
}
