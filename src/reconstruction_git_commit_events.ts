// Recorded `git commit` events parsed out of the transcript's Bash commands (split from
// reconstruction_git_operations.ts, 250-line cap): the commit markers' and git-evidence
// placement's shared source. Task 89: one event per `&&` segment matching gitCommitCommand.

import { getCorpusState } from "./reconstruction_corpus.ts";
import { BlockType, ToolName } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { gitAddCommand, gitCommitCommand } from "./regex_expressions.ts";
import { splitCompoundCommandSegments } from "./reconstruction_git_operations.ts";
import { resolveAgainstCwd } from "./structures/path-resolve.ts";

// A recorded `git commit`: the repo it committed in (the -C dir, else the record cwd), when, and
// the session whose Bash call ran it (for timeline attribution).
export type GitCommitEvent = { cwd?: Path; timestamp: Date; sessionId?: Uuid };

// One Bash command's commit events: one per `&&` segment matching `gitCommitCommand`, each with
// the segment's own -C dir (else the record cwd).
function parseCommitEventsFromCommand(
    command: string,
    recordCwd: Path | undefined,
    timestamp: Date,
    sessionId: Uuid | undefined,
): GitCommitEvent[] {
    const events: GitCommitEvent[] = [];
    for (const segment of splitCompoundCommandSegments(command)) {
        const match = segment.match(gitCommitCommand);
        if (match === null) continue;
        const dashCDir = match[1];
        events.push({
            cwd: dashCDir !== undefined ? new Path(dashCDir) : recordCwd,
            timestamp,
            sessionId,
        });
    }
    return events;
}

// A recorded `git add <path>`: one explicitly named path (resolved against the -C dir, else the
// record cwd) and when it was staged. Path-less forms (`git add -A`, `git add .`) name no explicit
// file and yield NO events — the staged-blob evidence channel only trusts an add that names its
// file. ponytail: explicit paths only; widen to `-A`/`.` via `git ls-files` if a scenario needs it.
export type GitAddEvent = { path: Path; cwd?: Path; timestamp: Date };

// One Bash command's add events: one per explicit path argument in each `&&` segment matching
// `gitAddCommand`.
function parseAddEventsFromCommand(command: string, recordCwd: Path | undefined, timestamp: Date): GitAddEvent[] {
    const events: GitAddEvent[] = [];
    for (const segment of splitCompoundCommandSegments(command)) {
        const match = segment.match(gitAddCommand);
        if (match === null) continue;
        const dashCDir = match[1];
        const cwd = dashCDir !== undefined ? new Path(dashCDir) : recordCwd;
        for (const argument of (match[2] ?? "").trim().split(/\s+/)) {
            if (argument === "") continue;
            if (argument.startsWith("-")) continue;
            if (argument === ".") continue;
            events.push({ path: new Path(resolveAgainstCwd(cwd, new Path(argument))), cwd, timestamp });
        }
    }
    return events;
}

// Every explicit-path `git add` Bash command in the transcript, in record order. Memoized like
// findGitCommitEvents — the per-file repair chain re-enters here for every reconstructed file.
export function findGitAddEvents(records: TranscriptRecord[]): GitAddEvent[] {
    const state = getCorpusState(records);
    if (state.gitAddEvents !== undefined) {
        return state.gitAddEvents;
    }
    const adds: GitAddEvent[] = [];
    for (const record of records) {
        const timestamp = record.timestamp;
        if (!(timestamp instanceof Date)) continue;
        const recordCwd = (record as { cwd?: Path }).cwd;
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_use || block.name !== ToolName.Bash) continue;
            const command = (block.input as { command?: string }).command;
            if (command === undefined) continue;
            adds.push(...parseAddEventsFromCommand(command, recordCwd, timestamp));
        }
    }
    state.gitAddEvents = adds;
    return adds;
}

// Every `git commit` Bash command in the transcript, in record order. Memoized per records
// identity in the corpus (pure group): the per-file repair chain re-enters here for every
// reconstructed file, and the result depends on the records alone.
export function findGitCommitEvents(records: TranscriptRecord[]): GitCommitEvent[] {
    const state = getCorpusState(records);
    if (state.gitCommitEvents !== undefined) {
        return state.gitCommitEvents;
    }
    const commits: GitCommitEvent[] = [];
    for (const record of records) {
        const timestamp = record.timestamp;
        if (!(timestamp instanceof Date)) continue;
        const recordCwd = (record as { cwd?: Path }).cwd;
        for (const block of getContentBlocks(record)) {
            if (block.type !== BlockType.tool_use || block.name !== ToolName.Bash) continue;
            const command = (block.input as { command?: string }).command;
            if (command === undefined) continue;
            commits.push(...parseCommitEventsFromCommand(command, recordCwd, timestamp, record.sessionId));
        }
    }
    state.gitCommitEvents = commits;
    return commits;
}
