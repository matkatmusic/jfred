// The full paths that log lines name for a file name: the file itself, and the same file name in other folders.

import { basename } from "node:path";
import type { Path } from "../src/structures/domain.ts";

const DELIMITER_CHARACTERS = "\"\\s'\\\\`<>|;,()=:";
const JSON_WHITESPACE_ESCAPE_PATTERN = /\\[nrt]/g;

function escapeRegExpText(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lines are searched in memory as JSON text: the logs are not read again. A relative path names no full path, so a match must start after a delimiter.
export function listPathsNamedInLines(lines: unknown[], file: Path): string[] {
    const fileName = escapeRegExpText(basename(file.toString()));
    const pathPattern = new RegExp(`(?<![^${DELIMITER_CHARACTERS}])(?:/[^${DELIMITER_CHARACTERS}/]+)*/${fileName}(?![\\w.\\-])`, "g");
    const namedPaths = new Set<string>();
    for (const line of lines) {
        const lineText = JSON.stringify(line).replace(JSON_WHITESPACE_ESCAPE_PATTERN, " ");
        for (const match of lineText.matchAll(pathPattern)) {
            namedPaths.add(match[0]);
        }
    }
    return [...namedPaths];
}
