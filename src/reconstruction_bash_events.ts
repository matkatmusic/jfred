// Bash command parsing: turn a Bash tool_use's command string into file events
// (`rm` -> delete, `mv`/`git mv` -> rename, `cp` -> copy, `>`/`>>` -> overwrite/append).
// Extraction proper (records -> events) lives in reconstruction_extract.ts.

import type { ToolUseBlock } from "./structures/content-blocks.ts";
import { EventKind } from "./structures/vocabulary.ts";
import { Path } from "./structures/domain.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";
import type {
    CopyInfo,
    FileEvent,
    RenameInfo,
} from "./reconstruction_engine.ts";
import {
    bashAppendRedirect,
    bashCopyCommand,
    bashMoveCommand,
    bashOverwriteRedirect,
    bashRemoveCommand,
    whitespaceRun,
} from "./regex_expressions.ts";

// Parse the target path out of an `rm <path>` Bash command (s1 has no flags).
// ponytail: splits on whitespace — no quoted-path support, add if a scenario needs it
export function parseRmTargets(command: string): Path[] {
    const match = command.trim().match(bashRemoveCommand);
    if (!match) {
        return [];
    }
    return match[1]!.trim().split(whitespaceRun).map((p) => new Path(p));
}

// Parse `mv <src> <dst>` or `git mv <src> <dst>` (two space-separated paths, no flags).
// s2 used plain `mv` with absolute paths; s6 uses `git mv` with cwd-relative paths.
export function parseMvPaths(command: string): RenameInfo | undefined {
    const match = command.trim().match(bashMoveCommand);
    if (!match) {
        return undefined;
    }
    return { from: new Path(match[1]!), to: new Path(match[2]!) };
}

// Parse `cp <src> <dst>` (two space-separated paths, no flags — the s3 form).
export function parseCpPaths(command: string): CopyInfo | undefined {
    const match = command.trim().match(bashCopyCommand);
    if (!match) {
        return undefined;
    }
    return { from: new Path(match[1]!), to: new Path(match[2]!) };
}

// The bash null device: `> /dev/null` discards output, so a redirect to it is not a write.
const NULL_DEVICE = "/dev/null";

// A parsed bash output redirection: the target file and whether it appends (`>>`)
// rather than overwrites (`>`).
type ParsedRedirect = {
    target: Path;
    appends: boolean;
};

// Characters that never appear in a real recorded redirect target but are common in command
// text the redirect regex can misfire on (a `node -e` one-liner's `=>` arrow, quoted JS,
// argument lists). A candidate containing any of them is command-text shrapnel, not a path.
// ponytail: deny-list, not a path grammar — extend the string if a new shrapnel shape appears.
const NON_PATH_CHARACTERS = "\"'`()<>{}$;,|";

// Whether a redirect-target candidate is plausible as a filesystem path (task 150): free of
// shell/JS punctuation that marks it as a fragment of command text.
function checkCandidateLooksLikePath(candidate: string): boolean {
    for (const character of NON_PATH_CHARACTERS) {
        if (candidate.includes(character)) {
            return false;
        }
    }
    return true;
}

// Parse a bash output redirection target: `>>` appends, `>` overwrites/creates. Returns the
// target and whether it appends, or undefined when there is no redirect. The content is NOT
// parsed from the command — it is recovered from the file-history sidecar (locked decision 3).
// task 150: a matched candidate that does not look like a path (an arrow-function fragment,
// quoted JS) is dropped here — the one choke point both extraction and line parsing share.
export function parseRedirect(command: string): ParsedRedirect | undefined {
    const appended = command.match(bashAppendRedirect);
    if (appended && appended[1] !== NULL_DEVICE && checkCandidateLooksLikePath(appended[1]!)) {
        return { target: new Path(appended[1]!), appends: true };
    }
    const overwritten = command.match(bashOverwriteRedirect);
    if (overwritten && overwritten[1] !== NULL_DEVICE && checkCandidateLooksLikePath(overwritten[1]!)) {
        return { target: new Path(overwritten[1]!), appends: false };
    }
    // `> /dev/null` (and `>>`) discards output — it is not a real file, so it must
    // never become a file event or show up in the Files list (task 76).
    return undefined;
}

// Turn a Bash tool_use into a file event: `rm` -> delete, `mv`/`git mv` -> rename, `cp` ->
// copy, else undefined (s1 uses rm; s2 uses mv; s3 uses cp; s6 uses git mv). The rename's
// relative paths are resolved against `cwd` so they match the absolute Write/Edit targets.
export function bashEventsFrom(
    block: ToolUseBlock,
    timestamp: Date,
    cwd: Path | undefined,
): FileEvent[] {
    const input = block.input as { command: string };
    const removed = parseRmTargets(input.command);
    if (removed.length > 0) {
        return removed.map((target) => ({ kind: EventKind.delete as const, changeId: block.id, target, timestamp }));
    }
    const moved = parseMvPaths(input.command);
    if (moved) {
        return [{
            kind: EventKind.rename,
            changeId: block.id,
            from: new Path(resolveAgainstCwd(cwd, moved.from)),
            to: new Path(resolveAgainstCwd(cwd, moved.to)),
            timestamp,
        }];
    }
    const copied = parseCpPaths(input.command);
    if (copied) {
        return [{
            kind: EventKind.copy,
            changeId: block.id,
            from: copied.from,
            to: copied.to,
            seedLines: [],
            timestamp,
        }];
    }
    const redirected = parseRedirect(input.command);
    if (redirected) {
        const kind = redirected.appends ? EventKind.append : EventKind.overwrite;
        return [{ kind, changeId: block.id, target: redirected.target, content: "", timestamp }];
    }
    return [];
}
