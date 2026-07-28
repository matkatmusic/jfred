// Layer 1 on-disk file walk (task 230, spec S18): the `current file state` — every file under
// the project folder, path relative to that folder, with its mtime. mtime is the Layer-1
// timestamp everywhere; birthtime is read only when trustworthy (task 298, readCreatedInstant). `.git` and
// `node_modules` are excluded unconditionally; ignored paths are honored — a folder the user
// points at may legitimately have no .gitignore, which is not an error.
//
// GIT ANSWERS FIRST when the folder is inside a repository, because git already knows three
// things this module would otherwise have to re-implement badly: it stops at a SUBMODULE gitlink
// exactly as `git ls-tree -r` does (jfred's four submodules hold 10,884 files that are not part
// of this project's state at all), it honors NESTED .gitignore files plus .git/info/exclude and
// core.excludesFile, and it distinguishes tracked from merely-present. The hand-rolled matcher
// below is the fallback for a plain folder that is in no repository — a legitimate Layer 1 input,
// since the two roots are independent.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";

// One file on disk: its path relative to the project folder, and its timestamps.
export interface DiskFileState {
    relativePath: Path;
    mtime: Date;
    createdAt?: Date;
}

// macOS/APFS records a real birthtime; ext4 frequently reports epoch 0 or echoes the mtime, and a
// copied file can claim a birth LATER than its mtime. Each of those yields no created node.
function readCreatedInstant(stats: { birthtime: Date; mtime: Date }): Date | undefined {
    const birth = stats.birthtime.getTime();
    return birth > 0 && birth < stats.mtime.getTime() ? stats.birthtime : undefined;
}

// Never walked, with or without a .gitignore (S18).
const ALWAYS_EXCLUDED_NAMES = [".git", "node_modules"];

// One usable line of a .gitignore, pre-compiled.
interface IgnoreRule {
    matcher: RegExp;
    directoriesOnly: boolean;
    anchored: boolean;
}

// A glob pattern as an anchored regex: `*` spans anything but a separator, `?` one such
// character, everything else is literal.
function buildPatternMatcher(pattern: string): RegExp {
    const source = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]");
    return new RegExp(`^${source}$`);
}

// The rules of the project folder's top-level .gitignore, or none when it has no .gitignore.
// ponytail: minimal matcher — blanks, `#` comments, a trailing `/` directory form, a leading
// `/` root-anchored form and `*`/`?` globs. NOT supported: `!` negations (skipped outright),
// `**` spans, nested .gitignore files, core.excludesFile, and git's escape syntax. Upgrade to
// the `ignore` package only when a real project folder is mis-walked because of one of those.
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
        // Git anchors a pattern to the root as soon as it carries a separator; otherwise it
        // matches by name at any depth.
        rules.push({
            matcher: buildPatternMatcher(trimmed),
            directoriesOnly,
            anchored: trimmed.includes("/") || pattern.startsWith("/"),
        });
    }
    return rules;
}

// Whether `relativePath` (a directory when `isDirectory`) is ignored by any rule. An ignored
// directory is never descended into, so its contents need no rule of their own.
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

// Depth-first accumulation into `found`. `relativeFolder` is "" at the root. Entries that are
// neither a directory nor a regular file (symlinks, sockets) are silently skipped — a Layer-1
// pair needs real bytes on disk.
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
        const stats = statSync(join(absoluteFolder, entry.name));
        found.push({ relativePath: new Path(relativePath), mtime: stats.mtime, createdAt: readCreatedInstant(stats) });
    }
}

// The working-tree paths git reports for `projectFolder` — tracked files plus untracked ones git
// does not ignore — relative to that folder, or undefined when the folder is in no repository.
//
// A failure is SWALLOWED here, unlike layer1_repo_tree.ts's loud throw: the ref there is something
// the user typed, whereas "this folder is not in a repo" is an ordinary Layer 1 input that the
// fallback walk handles. `--others` never descends into a submodule, which is the whole reason
// this call exists.
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

// S18 excludes these unconditionally, with or without a .gitignore. Git's own answer already omits
// `.git`, but a project that neither tracks NOR ignores `node_modules` would otherwise flood the
// view with its contents as untracked files — the same defect submodules produced.
function checkPathIsAlwaysExcluded(relativePath: string): boolean {
    return relativePath.split("/").some((segment) => ALWAYS_EXCLUDED_NAMES.includes(segment));
}

// Each git-named path with its mtime. Two kinds of entry fall out here rather than being filtered
// upstream, because one stat answers both: a SUBMODULE gitlink, which git names as one path whose
// disk entry is a directory, and a tracked-but-deleted file, which has no disk entry at all.
// Layer 1's `current file state` means real bytes present right now.
function statWorkingTreePaths(projectFolder: Path, relativePaths: string[]): DiskFileState[] {
    const found: DiskFileState[] = [];
    for (const relativePath of relativePaths) {
        if (checkPathIsAlwaysExcluded(relativePath)) {
            continue;
        }
        const stats = statSync(join(projectFolder.toString(), relativePath), { throwIfNoEntry: false });
        if (stats?.isFile() === true) {
            found.push({ relativePath: new Path(relativePath), mtime: stats.mtime, createdAt: readCreatedInstant(stats) });
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
