// Task 355 step 5: Edit/Write/Read events join to pairs by relative path and shape into the /api/layer1-edits wire view.

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { WireEditOf, WireEditsViewOf } from "../webapp/layer1-wire.ts";
import { compareEditEvents, readSessionEditEvents, type LayerEditEvent } from "./layer1_edit_events.ts";
import { replayPathEvents, type ReplayedEditNode } from "./layer1_edit_replay.ts";
import { relativizeToProjectFolder } from "./layer1_snapshot_wire.ts";
import { loadTranscript, type ProgressSink } from "./parse/loadTranscript.ts";
import { splitLines } from "./reconstruction_replay_edit.ts";
import { backupSeedWriteFor } from "./reconstruction_sidecar.ts";
import { createSidecarReader, resolveFileHistoryRoot } from "./reconstruction_sidecar_reader.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";

// Named so tests assert the same string the route emits.
export const LAYER1_PROGRESS_LABEL_READING_EDITS = "reading Edit/Write events";

export type Layer1WireEditsView = WireEditsViewOf<Date, Path, Uuid>;

// One session at a time so the per-file parse can be counted; mirrors collectViewSnapshotsByRelativePath.
export function collectViewEditEventsByRelativePath(
    projectFolder: Path,
    sessionFiles: readonly Path[],
    reportProgress: ProgressSink = () => {},
): Map<string, LayerEditEvent[]> {
    const byRelativePath = new Map<string, LayerEditEvent[]>();
    sessionFiles.forEach((sessionFile, index) => {
        reportProgress({
            kind: DocumentResponseKind.progress,
            label: LAYER1_PROGRESS_LABEL_READING_EDITS,
            current: index + 1,
            total: sessionFiles.length,
        });
        for (const event of readSessionEditEvents(sessionFile)) {
            const relativePath = relativizeToProjectFolder(projectFolder, event.target.toString());
            if (relativePath === undefined) {
                continue;
            }
            byRelativePath.set(relativePath, (byRelativePath.get(relativePath) ?? []).concat(event));
        }
    });
    for (const events of byRelativePath.values()) {
        events.sort(compareEditEvents);
    }
    return byRelativePath;
}

// The pre-edit lines from the owning session's file-history backup; undefined when no backup exists.
export function readBackupSeedLines(event: LayerEditEvent): string[] | undefined {
    const records = loadTranscript(event.sessionFile.toString(), undefined, true).records;
    const root = resolveFileHistoryRoot(records);
    if (!existsSync(join(root.toString(), event.sessionId.toString()))) {
        return undefined;
    }
    const reader = createSidecarReader(event.sessionId, root);
    const seed = backupSeedWriteFor(records, event.target, event.instant, reader, true);
    return seed === undefined ? undefined : splitLines(seed.content);
}

export function buildWireEdit(event: LayerEditEvent, node: ReplayedEditNode): Omit<WireEditOf<Date, Path, Uuid>, "axisPx"> {
    return {
        instant: event.instant,
        kind: event.kind,
        changeId: event.changeId,
        confidence: node.confidence,
        sessionId: event.sessionId,
        sessionFile: event.sessionFile,
        // An absent line must stay absent: a `line: undefined` KEY differs under deep equality.
        ...(event.line === undefined ? {} : { line: event.line }),
    };
}

export function buildEditsView(
    projectFolder: Path,
    sessionFiles: readonly Path[],
    reportProgress: ProgressSink = () => {},
): Layer1WireEditsView {
    const pairs: Layer1WireEditsView["pairs"] = [];
    for (const [relativePath, events] of collectViewEditEventsByRelativePath(projectFolder, sessionFiles, reportProgress)) {
        const nodes = replayPathEvents(events, readBackupSeedLines);
        pairs.push({
            path: new Path(relativePath),
            edits: events.map((event) => buildWireEdit(event, nodes.get(event.changeId.toString())!)),
        });
    }
    return { pairs };
}
