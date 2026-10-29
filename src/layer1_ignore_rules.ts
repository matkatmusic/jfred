// Top-level .gitignore matching for the manual Layer 1 disk walk.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Path } from "./structures/domain.ts";

// One usable line of a .gitignore, pre-compiled.
export interface IgnoreRule {
  matcher: RegExp;
  directoriesOnly: boolean;
  anchored: boolean;
}

const REGEX_SPECIAL_CHARS = /[.+^${}()|[\]\\]/g;
const STAR_GLOB = /\*/g;
const QUESTION_GLOB = /\?/g;

// Converts a glob pattern to an anchored regex (`*`/`?` only).
function buildPatternMatcher(pattern: string): RegExp {
  const escaped = pattern.replace(REGEX_SPECIAL_CHARS, "\\$&");
  const withStars = escaped.replace(STAR_GLOB, "[^/]*");
  const source = withStars.replace(QUESTION_GLOB, "[^/]");
  return new RegExp(`^${source}$`);
}

// ponytail: no `!` negations, `**`, nested .gitignore or core.excludesFile; use `ignore` package if mis-walked.
export function readIgnoreRules(projectFolder: Path): IgnoreRule[] {
  let text: string;
  try {
    text = readFileSync(join(projectFolder.toString(), ".gitignore")).toString();
  }
  catch {
    return [];
  }
  const rules: IgnoreRule[] = [];
  for (const line of text.split("\n")) {
    const pattern = line.trim();
    const isBlank = pattern === "";
    const isComment = pattern.startsWith("#");
    const isNegation = pattern.startsWith("!");
    const isSkipped = isBlank || isComment || isNegation;
    if (isSkipped) {
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
export function isPathIgnored(relativePath: string, isDirectory: boolean, rules: IgnoreRule[]): boolean {
  const name = relativePath.split("/").at(-1) ?? relativePath;
  for (const rule of rules) {
    const skipsFile = rule.directoriesOnly && !isDirectory;
    if (skipsFile) {
      continue;
    }
    const target = rule.anchored ? relativePath : name;
    const isMatch = rule.matcher.test(target);
    if (isMatch) {
      return true;
    }
  }
  return false;
}
