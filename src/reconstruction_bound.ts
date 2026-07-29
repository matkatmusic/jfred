// task 193: bounded reconstruction via input truncation at the nth revision's turn end.

import { Path, Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, EventKind } from "./structures/vocabulary.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { isGenuineUserPrompt } from "./reconstruction_prompts.ts";
import type { CliOptions } from "./reconstruction_cli_args.ts";

// Cut stream, total revision count, and wall-clock boundary instant (undefined if final turn).
export type RevisionBound = {
    records: TranscriptRecord[];
    totalRevisions: number;
    boundInstant: Date | undefined;
};

// task 194: webapp bounded-mode request — truncate at file's ordinal-th revision turn end.
export type RevisionBoundRequest = {
    file: Path;
    ordinal: number;
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

// Filter events touching target by exact-path equality in timestamp order.
function selectEventsTouchingPath(events: FileEvent[], target: Path): FileEvent[] {
    const targetKey = target.toString();
    return events.filter((event) =>
        listEventPaths(event).some((eventPath) => eventPath.toString() === targetKey),
    );
}

// Only main-chain genuine prompts end a turn; sidechain prompts do not.
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

// Find the session that produced this event via its changeId (uuid or tool_use id).
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

// First turn-boundary prompt strictly after `after` in the owning session; undefined at stream end.
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

// Stamped records survive if strictly before the boundary instant; unstamped survive by index.
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

// Truncate records at the turn containing the target's nth revision; throws on missing/out-of-range.
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
    return { records: kept, totalRevisions: revisions.length, boundInstant: boundary.instant };
}

// No-op without --until-revision; otherwise truncate and report summary on stderr.
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

