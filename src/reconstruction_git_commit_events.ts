// Recorded `git commit` events parsed out of the transcript's Bash commands (split from
// reconstruction_git_operations.ts, 250-line cap): the commit markers' and git-evidence
// placement's shared source. Task 89: one event per `&&` segment matching gitCommitCommand.

import { getCorpusState } from "./reconstruction_corpus.ts";
import { BlockType, ToolName } from "./structures/vocabulary.ts";
import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { gitCommitCommand } from "./regex_expressions.ts";
import { splitCompoundCommandSegments } from "./reconstruction_git_operations.ts";

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
