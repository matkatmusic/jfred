// Task 330: the fixture's per-language file bodies, ported wholesale from plans/layer2-mockup/app.js.
//
// Revision-varying bytes keyed by (path, node), derived from node identity via a clock-free seed.

// What one node's bytes are called; a snapshot differs per owning SESSION, not by name (#300/#305).
export interface FixtureRevisionNode {
    kind: string;
    hash?: string;
    version?: string;
    session?: string;
}

// One canned body per LANGUAGE, long enough that a 3-line context window drops something (#320).
const TEMPLATES: Record<string, string[]> = {
    ts: ['import { parse } from "./parse";', 'import { Logger } from "./logger";', "",
        "// dispatch one scenario case", "export function run(input: string): string {",
        "  const cleaned = input.trim();", "  if (cleaned.length > 0) return parse(cleaned);",
        '  throw new Error("empty input");', "}", "",
        "// the settled middle of the file: nothing below here changes between revisions, which is",
        "// what gives the full-content toggle something to reveal.", "",
        "export function describe(kind: string): string {", "  switch (kind) {",
        '    case "commit": return "a commit";', '    case "snapshot": return "a snapshot";',
        '    default: return "the working tree";', "  }", "}", "",
        "export const VERSION = 1;"],
    py: ['"""Dispatch one scenario case."""', "import sys", "",
        "def run(text):", "    cleaned = text.strip()", "    if len(cleaned) > 0:",
        "        return cleaned.lower()", '    raise ValueError("empty input")', "",
        "# the settled middle of the file: unchanged between revisions.", "",
        "def describe(kind):", '    if kind == "commit":', '        return "a commit"',
        '    if kind == "snapshot":', '        return "a snapshot"',
        '    return "the working tree"', "", "VERSION = 1"],
    sh: ["#!/usr/bin/env bash", "set -euo pipefail", "",
        "# push the built bundle", 'TARGET="${1:-staging}"',
        "if [ -d dist ]; then", '  rsync -a dist/ "deploy@host:/srv/$TARGET"', "fi", "",
        "# the settled middle of the file: unchanged between revisions.", "",
        "describe() {", '  case "$1" in', '    commit) echo "a commit" ;;',
        '    snapshot) echo "a snapshot" ;;', '    *) echo "the working tree" ;;', "  esac", "}", "",
        "VERSION=1"],
    md: ["# demo-app", "", "The notes this repository used to keep for the old API.", "",
        "- one bullet", "- another", "", "## Unchanged section", "",
        "The paragraphs below are the same in every revision, so a windowed diff hides them",
        "and the full-content toggle brings them back.", "", "- stable", "- stable", "- stable", "",
        "## End"],
    txt: ["plain text has no grammar to colour,", "so #294 leaves it exactly as it is.", "",
        "the lines below never change between revisions,", "which is what a windowed diff drops",
        "and what the full-content toggle restores.", "", "one", "two", "three", "four", "five"],
};

const LINE_COMMENT: Record<string, string> = { ts: "//", py: "#", sh: "#" };
const LANGUAGES: Record<string, string> = { ts: "ts", tsx: "ts", js: "ts", jsx: "ts", py: "py",
    sh: "sh", bash: "sh", md: "md", txt: "txt" };

function languageOf(path: string): string {
    return LANGUAGES[path.slice(path.lastIndexOf(".") + 1)] ?? "txt";
}

function revisionStamp(node: FixtureRevisionNode): string {
    if (node.kind === "snapshot") {
        return `${node.version} of ${node.session}`;
    }
    if (node.kind === "commit") {
        return (node.hash ?? "").slice(0, 8);
    }
    return "working tree";
}

// Stable and clock-free: the headless checks compare one render against another.
function seedOf(text: string): number {
    return [...text].reduce((accumulator, character) => (accumulator * 31 + character.charCodeAt(0)) % 9973, 7);
}

// One node's bytes, derived from its identity: a stamped line, a modified line, and a maybe added/removed one.
export function contentLines(path: string, node: FixtureRevisionNode): string[] {
    const language = languageOf(path);
    const lines = [...TEMPLATES[language]!];
    const stamp = revisionStamp(node);
    const seed = seedOf(stamp);
    const note = LINE_COMMENT[language];
    lines.splice(1, 0, note ? `${note} revision ${stamp}` : `revision ${stamp}`);
    const changed = 3 + (seed % Math.max(1, lines.length - 4));
    lines[changed] += note ? `  ${note} r${seed % 100}` : ` (r${seed % 100})`;
    if (seed % 2 === 0) {
        lines.push(note ? `${note} TODO(${seed % 100}): revisit before release`
            : `TODO(${seed % 100}): revisit before release`);
    }
    if (seed % 3 === 0) {
        lines.splice(2, 1);
    }
    return lines;
}

