// task 193: bounded reconstruction up to a file's nth revision. The bound is implemented as
// INPUT truncation — the merged record stream is cut at the end of the chosen revision's
// containing agent turn, so the sidecar reader, the script-run pool, and every view are
// bounded by construction and no engine internals change. Turns are per-session: the turn
// end is the OWNING session's next genuine prompt (interleaved parallel-session streams —
// jot, RevEng — carry other sessions' prompts mid-turn), and the cut is by wall clock so
// every session's in-window records survive.

import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, EventKind } from "./structures/vocabulary.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";

// The truncation result: the (possibly cut) record stream, the target's total revision count
// across the FULL stream (reported so the user can pick the next ordinal), and the last kept
// record's instant (undefined when the chosen revision sits in the final turn — nothing cut).
export type RevisionBound = {
    records: TranscriptRecord[];
    totalRevisions: number;
    boundInstant: Date | undefined;
};

// The path fields an event carries: rename/copy name from→to, every other kind a target.
export function listEventPaths(event: FileEvent): Path[] {
    if (event.kind === EventKind.rename) {
        return [event.from, event.to];
    }
    if (event.kind === EventKind.copy) {
        return [event.from, event.to];
    }
    return [event.target];
}

// The target's revisions = every file event naming it, in extractFileEvents' timestamp order.
// Exact-path equality, matching the --target/--file selector's contract.
function selectEventsTouchingPath(events: FileEvent[], target: Path): FileEvent[] {
    const targetKey = target.toString();
    return events.filter((event) =>
        listEventPaths(event).some((eventPath) => eventPath.toString() === targetKey),
    );
}

// A turn boundary is a genuine typed-in prompt on the MAIN chain — a subagent's opening prompt
// (isSidechain) happens inside the parent's turn and must not end it.
function isTurnBoundary(record: TranscriptRecord): boolean {
    if (record.isSidechain === true) {
        return false;
    }
    return isGenuineUserPrompt(record);
}

// True when one of the record's tool_use blocks carries this change id.
function recordCarriesToolUse(record: TranscriptRecord, changeKey: string): boolean {
    return getContentBlocks(record).some(
        (block) => block.type === BlockType.tool_use && block.id.toString() === changeKey,
    );
}

// The sessionId of the record that produced `event`: a user-edit's changeId is the attachment
// record's own uuid, every other kind's changeId is a tool_use block id. Undefined when no
// record matches (falls back to a session-agnostic turn walk).
function findEventSessionId(records: TranscriptRecord[], event: FileEvent): Uuid | undefined {
    const changeKey = event.changeId.toString();
    for (const record of records) {
        if (record.uuid?.toString() === changeKey) {
            return record.sessionId;
        }
        if (recordCarriesToolUse(record, changeKey)) {
            return record.sessionId;
        }
    }
    return undefined;
}

// The end of the OWNING session's turn: the first of ITS turn-boundary prompts STRICTLY after
// `after` (a prompt stamped at the event instant stays inside the turn). Undefined when the
// turn runs to the end of the stream. Without an owner session the walk is session-agnostic.
function findTurnEndBoundary(
    records: TranscriptRecord[],
    after: Date,
    ownerSession: Uuid | undefined,
): { index: number; instant: Date } | undefined {
    for (let index = 0; index < records.length; index++) {
        const record = records[index]!;
        if (!isTurnBoundary(record)) {
            continue;
        }
        if (ownerSession !== undefined && record.sessionId?.toString() !== ownerSession.toString()) {
            continue;
        }
        if (!(record.timestamp instanceof Date)) {
            continue;
        }
        if (record.timestamp.getTime() > after.getTime()) {
            return { index, instant: record.timestamp };
        }
    }
    return undefined;
}

// Wall-clock cut: a stamped record survives iff it lies strictly before the turn-end instant
// (other sessions' in-window records included); a stamp-less record (session meta) survives by
// its position before the boundary prompt.
function recordIsWithinBound(
    record: TranscriptRecord,
    index: number,
    boundary: { index: number; instant: Date },
): boolean {
    if (record.timestamp instanceof Date) {
        return record.timestamp.getTime() < boundary.instant.getTime();
    }
    return index < boundary.index;
}

// Cut the record stream at the end of the agent turn containing the target's nth revision
// (1-based). Throws when the target has no revisions or the ordinal is out of range — the
// message carries the total so the caller can pick a valid ordinal next time.
export function truncateRecordsAtRevisionTurnEnd(
    records: TranscriptRecord[],
    target: Path,
    ordinal: number,
): RevisionBound {
    const revisions = selectEventsTouchingPath(extractFileEvents(records), target);
    if (revisions.length === 0) {
        throw new Error(`--until-revision: no revisions of ${target} found`);
    }
    if (ordinal < 1 || ordinal > revisions.length) {
        throw new Error(`--until-revision: revision ${ordinal} of ${target} out of range 1..${revisions.length}`);
    }
    const chosen = revisions[ordinal - 1]!;
    const ownerSession = findEventSessionId(records, chosen);
    const boundary = findTurnEndBoundary(records, chosen.timestamp, ownerSession);
    if (boundary === undefined) {
        return { records, totalRevisions: revisions.length, boundInstant: undefined };
    }
    const kept = records.filter((record, index) => recordIsWithinBound(record, index, boundary));
    const lastKeptInstant = kept[kept.length - 1]?.timestamp;
    const boundInstant = lastKeptInstant instanceof Date ? lastKeptInstant : chosen.timestamp;
    return { records: kept, totalRevisions: revisions.length, boundInstant };
}

// CLI glue: a no-op without --until-revision; otherwise truncate and report the pick-your-n
// summary on stderr (stdout stays pure for --json consumers).
export function applyRevisionBound(records: TranscriptRecord[], options: CliOptions): TranscriptRecord[] {
    if (options.untilRevision === undefined) {
        return records;
    }
    const bound = truncateRecordsAtRevisionTurnEnd(records, options.untilRevision, options.untilNth);
    const boundLabel = bound.boundInstant?.toISOString() ?? "end of transcript";
    process.stderr.write(
        `until-revision: ${options.untilRevision} revision ${options.untilNth}/${bound.totalRevisions}; bounded at ${boundLabel}; records ${bound.records.length}/${records.length}\n`,
    );
    return bound.records;
}
