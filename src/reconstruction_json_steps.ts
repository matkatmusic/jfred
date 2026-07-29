// Skeleton step-snapshot builders and changeId-to-path/session indexes for the JSON document.

import type { Uuid } from "./structures/domain.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import { BlockType } from "./structures/vocabulary.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { reconstructStepTimeline } from "./reconstruction_steps.ts";
import { reconstructAll, type FileHistory } from "./reconstruction_engine.ts";
import type { BackupReader } from "./reconstruction_sidecar.ts";
import { ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX } from "./reconstruction_reseed.ts";
import { resolveScriptRunChangeIdToSourceId } from "./reconstruction_script_execution.ts";
import { reportReconstructionProgress } from "./reconstruction_progress.ts";

// Skeleton only — file text resolved on demand to avoid the 512 MB RangeError.
export type StepSnapshot = {
    index: number;
    when: Date;
    changeIds: Uuid[];
    changedPaths: string[];
    sessionId: Uuid | undefined;
};

// Maps changeIds to their source sessionId via tool_use block ids and record uuids.
function indexToolUseBlockIdsToSessionId(record: TranscriptRecord, sessionId: Uuid, byChangeId: Map<string, Uuid>): void {
    for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_use) {
            byChangeId.set(block.id.toString(), sessionId);
        }
    }
}

function indexChangeIdsToSessionIds(records: TranscriptRecord[]): Map<string, Uuid> {
    const byChangeId = new Map<string, Uuid>();
    for (const record of records) {
        if (record.sessionId === undefined) {
            continue;
        }
        if (record.uuid !== undefined) {
            byChangeId.set(record.uuid.toString(), record.sessionId);
        }
        indexToolUseBlockIdsToSessionId(record, record.sessionId, byChangeId);
    }
    return byChangeId;
}

// Strips synthetic prefixes (originalFile:, scriptRun:) to recover the real changeId.
function resolveSyntheticChangeIdToSourceId(changeId: string): string {
    if (changeId.startsWith(ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX)) {
        return changeId.slice(ORIGINAL_FILE_SEED_CHANGE_ID_PREFIX.length);
    }
    const scriptRunSourceId = resolveScriptRunChangeIdToSourceId(changeId);
    if (scriptRunSourceId !== undefined) {
        return scriptRunSourceId;
    }
    return changeId;
}

// Maps each changeId to the final path of the file it touched.
function indexChangeIdsToPaths(histories: FileHistory[]): Map<string, string> {
    const byChangeId = new Map<string, string>();
    for (const history of histories) {
        for (const revision of history.revisions) {
            byChangeId.set(revision.changeId.toString(), history.target.toString());
        }
    }
    return byChangeId;
}

function findSessionIdForChangeIds(changeIds: Uuid[], sessionOf: Map<string, Uuid>): Uuid | undefined {
    return changeIds
        .map((id) => sessionOf.get(resolveSyntheticChangeIdToSourceId(id.toString())))
        .find((sessionId) => sessionId !== undefined);
}

export function buildStepSnapshots(
    records: TranscriptRecord[],
    reader: BackupReader | undefined,
    surviving?: FileHistory[],
): { steps: StepSnapshot[]; stepFileHistories: FileHistory[] } {
    const { histories, changes } = reconstructStepTimeline(records, reader);
    reportReconstructionProgress("indexing change ids across surviving files");
    const pathOf = indexChangeIdsToPaths(surviving ?? reconstructAll(records, reader));
    const sessionOf = indexChangeIdsToSessionIds(records);
    const steps = changes.map((change, index) => {
        const changeIds = change.changeIds;
        // ponytail: best-effort — a step's triggering changeId is not always a surviving revision's changeId (the engine re-stamps revisions during beacon/reseed completion), so off-branch or re-stamped steps resolve to []. changeIds is the reliable pointer; changedPaths is the hint.  Script-execution changeIds are deterministic (scriptRun:<source>:<target>, item 34), so the step-timeline and file-history replays stamp the same id and those steps DO resolve.
        const changedPaths = [
            ...new Set(changeIds.map((id) => pathOf.get(id.toString())).filter((p): p is string => p !== undefined)),
        ];
        return {
            index: index + 1,
            when: change.when,
            changeIds,
            changedPaths,
            sessionId: findSessionIdForChangeIds(changeIds, sessionOf),
        };
    });
    return { steps, stepFileHistories: histories };
}
