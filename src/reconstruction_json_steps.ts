// Step-snapshot builders for the JSON document: skeleton step rows (index/when/changeIds/changedPaths)
// plus the changeId -> path / sessionId indexes they resolve through. Split from reconstruction_json.ts
// (task 92); the document assembly stays there.

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

// A step snapshot is a SKELETON: index/when/changeIds/changedPaths only, no file contents. A step's
// file text is resolved on demand from the separately-returned stepFileHistories (resolveFilesAtStep),
// so the document stays small enough to JSON.stringify (the >512 MB RangeError fix).
export type StepSnapshot = {
    index: number;
    when: Date;
    changeIds: Uuid[];
    changedPaths: string[];
    sessionId: Uuid | undefined;
};

// A changeId(string) -> source sessionId index. Two id namespaces resolve here, so a step's changeIds
// can be attributed to the session that evidenced them: every tool_use block's id, and every record's
// own uuid (a user-edit evidence splice carries a file-history-snapshot RECORD uuid as its changeId —
// s40 step 5). The namespaces are disjoint (toolu_… / cse_… vs RFC-4122), so adding record uuids never
// shadows a tool_use id. Synthetic changeIds that match neither (e.g. a `<blob>@vN` ref) resolve to nothing.
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

// Un-wrap a synthetic changeId to the source id the index knows. An `originalFile` seed stamps
// `originalFile:<real edit changeId>` (reconstruction_reseed); stripping the prefix exposes the real
// tool_use id (s40 step 3). A `scriptRun:<tool_use id>:<target>` script-execution id
// (reconstruction_script_execution) unwraps to its tool_use id the same way (item 34). A plain
// changeId — real, or a record-uuid evidence splice — is returned as-is.
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

// A changeId(string) -> final path(string) index across every reconstructed file, so a step's
// changeIds can be resolved to the file paths they touched.
function indexChangeIdsToPaths(histories: FileHistory[]): Map<string, string> {
    const byChangeId = new Map<string, string>();
    for (const history of histories) {
        for (const revision of history.revisions) {
            byChangeId.set(revision.changeId.toString(), history.target.toString());
        }
    }
    return byChangeId;
}

// The skeleton step snapshots AND the compact branch-agnostic histories they derive from, returned
// together so a reader can resolve any one step's file text on demand (resolveFilesAtStep) without the
// document ever carrying per-step file contents. `surviving` lets a caller that already reconstructed
// the surviving branch (the document builder's BranchedReconstruction) share it; absent, it is derived.
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
        // ponytail: best-effort — a step's triggering changeId is not always a surviving revision's
        // changeId (the engine re-stamps revisions during beacon/reseed completion), so off-branch or
        // re-stamped steps resolve to []. changeIds is the reliable pointer; changedPaths is the hint.
        // Script-execution changeIds are deterministic (scriptRun:<source>:<target>, item 34), so the
        // step-timeline and file-history replays stamp the same id and those steps DO resolve.
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
