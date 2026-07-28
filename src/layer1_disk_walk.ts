// Layer 1 on-disk file walk: mtime-stamped paths via git when available, manual walk otherwise.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";

// One file on disk: its path relative to the project folder, and its mtime.
export interface DiskFileState {
    relativePath: Path;
    mtime: Date;
}

// Never walked, with or without a .gitignore (S18).
const ALWAYS_EXCLUDED_NAMES = [".git", "node_modules"];

// One usable line of a .gitignore, pre-compiled.
interface IgnoreRule {
    matcher: RegExp;
    directoriesOnly: boolean;
    anchored: boolean;
}

// Converts a glob pattern to an anchored regex (`*`/`?` only).
function buildPatternMatcher(pattern: string): RegExp {
    const source = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]");
    return new RegExp(`^${source}$`);
}

// The rules of the project folder's top-level .gitignore, or none when it has no .gitignore.
// ponytail: minimal matcher — blanks, `#` comments, a trailing `/` directory form, a leading `/` root-anchored form and `*`/`?` globs. NOT supported: `!` negations (skipped outright), `**` spans, nested .gitignore files, core.excludesFile, and git's escape syntax. Upgrade to the `ignore` package only when a real project folder is mis-walked because of one of those.
function readIgnoreRules(projectFolder: Path): IgnoreRule[] {
    let text: string;
    try {
        text = readFileSync(join(projectFolder.toString(), ".gitignore")).toString();
    } catch {
        return [];
    }
    const rules: IgnoreRule[] = [];
    for (const line of text.split("\n")) {
        const pattern = line.trim();
        if (pattern === "" || pattern.startsWith("#") || pattern.startsWith("!")) {
            continue;
        }
        const directoriesOnly = pattern.endsWith("/");
        const trimmed = pattern.replace(/\/$/, "").replace(/^\//, "");
        // Patterns with a separator are root-anchored; bare names match at any depth.
        rules.push({
            matcher: buildPatternMatcher(trimmed),
            directoriesOnly,
            anchored: trimmed.includes("/") || pattern.startsWith("/"),
        });
    }
    return rules;
}

// Returns true if any ignore rule matches; ignored directories are never descended into.
function checkPathIsIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
    const name = relativePath.split("/").at(-1) ?? relativePath;
    for (const rule of rules) {
        if (rule.directoriesOnly && !isDirectory) {
            continue;
        }
        if (rule.matcher.test(rule.anchored ? relativePath : name)) {
            return true;
        }
    }
    return false;
}

// Depth-first walk; skips symlinks and sockets since Layer 1 needs real bytes on disk.
function collectFolderFiles(projectFolder: Path, relativeFolder: string, rules: IgnoreRule[], found: DiskFileState[]): void {
    const absoluteFolder = join(projectFolder.toString(), relativeFolder);
    for (const entry of readdirSync(absoluteFolder, { withFileTypes: true })) {
        if (ALWAYS_EXCLUDED_NAMES.includes(entry.name)) {
            continue;
        }
        const relativePath = relativeFolder === "" ? entry.name : `${relativeFolder}/${entry.name}`;
        if (checkPathIsIgnored(relativePath, entry.isDirectory(), rules)) {
            continue;
        }
        if (entry.isDirectory()) {
            collectFolderFiles(projectFolder, relativePath, rules, found);
            continue;
        }
        if (!entry.isFile()) {
            continue;
        }
        found.push({ relativePath: new Path(relativePath), mtime: statSync(join(absoluteFolder, entry.name)).mtime });
    }
}

// Git-tracked and untracked paths, or undefined when not in a repo.
function listGitWorkingTreeFiles(projectFolder: Path): string[] | undefined {
    const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
        cwd: projectFolder.toString(),
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) {
        return undefined;
    }
    return result.stdout.split("\0").filter((path) => path !== "");
}

// Git omits `.git` but untracked `node_modules` would flood results without this guard.
function checkPathIsAlwaysExcluded(relativePath: string): boolean {
    return relativePath.split("/").some((segment) => ALWAYS_EXCLUDED_NAMES.includes(segment));
}

// Stats each path; submodule gitlinks and deleted files drop out via the isFile check.
function statWorkingTreePaths(projectFolder: Path, relativePaths: string[]): DiskFileState[] {
    const found: DiskFileState[] = [];
    for (const relativePath of relativePaths) {
        if (checkPathIsAlwaysExcluded(relativePath)) {
            continue;
        }
        const stats = statSync(join(projectFolder.toString(), relativePath), { throwIfNoEntry: false });
        if (stats?.isFile() === true) {
            found.push({ relativePath: new Path(relativePath), mtime: stats.mtime });
        }
    }
    return found;
}

// The `current file state` of `projectFolder`, sorted by relative path for determinism.
export function walkCurrentFileState(projectFolder: Path): DiskFileState[] {
    const gitPaths = listGitWorkingTreeFiles(projectFolder);
    const found: DiskFileState[] = [];
    if (gitPaths === undefined) {
        collectFolderFiles(projectFolder, "", readIgnoreRules(projectFolder), found);
    } else {
        found.push(...statWorkingTreePaths(projectFolder, gitPaths));
    }
    return found.sort((left, right) => (left.relativePath.toString() < right.relativePath.toString() ? -1 : 1));
}


