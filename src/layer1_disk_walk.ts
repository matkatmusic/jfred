// Layer 1 on-disk file walk (task 230, spec S18): the `current file state` — every file under
// the project folder, path relative to that folder, with its mtime. mtime is the Layer-1
// timestamp everywhere (S18: birthtime is not portable, so it is never read). `.git` and
// `node_modules` are excluded unconditionally; a top-level `.gitignore` is honored when one
// exists — a folder the user points at may legitimately have none, which is not an error.

import { readdirSync, readFileSync, statSync } from "node:fs";
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
        found.push({ relativePath: new Path(relativePath), mtime: statSync(join(absoluteFolder, entry.name)).mtime });
    }
}

// The `current file state` of `projectFolder`, sorted by relative path for determinism.
export function walkCurrentFileState(projectFolder: Path): DiskFileState[] {
    const found: DiskFileState[] = [];
    collectFolderFiles(projectFolder, "", readIgnoreRules(projectFolder), found);
    return found.sort((left, right) => (left.relativePath.toString() < right.relativePath.toString() ? -1 : 1));
}
