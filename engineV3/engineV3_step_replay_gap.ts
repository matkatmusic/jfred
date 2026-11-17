// The gap that a step stop on a script leaves: found from the finished walk, or refused with a reason.

import type { Path } from "../src/structures/domain.ts";
import { StopGapKind } from "../src/structures/vocabulary.ts";
import type { RecordSource } from "../src/parse/loadTranscript.ts";
import { listKnownStatesForFile } from "./engineV3_file_known_states.ts";
import type { InverseCommit } from "./engineV3_inverse_repo.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { convertScriptRunToTaskRecord, listReplayGapsFromStates, type ReplayGap } from "./engineV3_script_replay_gaps.ts";
import { getScriptReplayRefusal } from "./engineV3_script_replay_run.ts";
import { ScriptReplayTaskReason, type ScriptReplayTask } from "./engineV3_script_replay_tasks.ts";

export type StopGap =
    | { kind: StopGapKind.Found; gap: ReplayGap; startText: string | undefined; tasks: ScriptReplayTask[] }
    | { kind: StopGapKind.Refused; reason: string };

function createRefusal(reason: string): StopGap {
    return { kind: StopGapKind.Refused, reason };
}

function isEventAtSource(event: FileEvent, source: RecordSource): boolean {
    if (event.source === undefined) {
        return false;
    }
    if (event.source.filePath !== source.filePath) {
        return false;
    }
    return event.source.lineNumber === source.lineNumber;
}

function isScriptStopInGap(gap: ReplayGap, stopSource: RecordSource): boolean {
    return gap.droppedStates.some((droppedState) => {
        if (droppedState.state.event.type !== FileEventType.ScriptMayWrite) {
            return false;
        }
        return isEventAtSource(droppedState.state.event, stopSource);
    });
}

// Oldest first: the dropped states run newest first.
function listScriptEventsOfGap(gap: ReplayGap): FileEvent[] {
    const scriptEvents: FileEvent[] = [];
    for (const droppedState of [...gap.droppedStates].reverse()) {
        if (droppedState.state.event.type === FileEventType.ScriptMayWrite) {
            if (!scriptEvents.includes(droppedState.state.event)) {
                scriptEvents.push(droppedState.state.event);
            }
        }
    }
    return scriptEvents;
}

export function findStopGap(events: FileEvent[], storedCommits: InverseCommit[], stopSource: RecordSource, recordedProjectFolder: Path, relativePath: string): StopGap {
    const states = listKnownStatesForFile(events);
    const gap = listReplayGapsFromStates(states).find((candidate) => isScriptStopInGap(candidate, stopSource));
    if (gap === undefined) {
        return createRefusal("the next older whole text confirms the carried text: the script left nothing to fill");
    }
    if (gap.olderPosition === undefined) {
        return createRefusal("the gap reaches the start of the history: the birth of the file is a guess");
    }
    const tipPosition = storedCommits[storedCommits.length - 1]!.position;
    for (const droppedState of gap.droppedStates) {
        if (droppedState.position <= tipPosition) {
            return createRefusal("a position of this gap already has a commit: press f only after r, never before");
        }
    }
    if (states[gap.newerPosition]!.event === gap.droppedStates[0]!.state.event) {
        return createRefusal("the gap is half dropped: its first state shares the event of the state above it");
    }
    const tasks: ScriptReplayTask[] = [];
    for (const scriptEvent of listScriptEventsOfGap(gap)) {
        if (scriptEvent.scriptRun === undefined) {
            throw new Error(`findStopGap: the script event at ${scriptEvent.source?.filePath}:${scriptEvent.source?.lineNumber} has no script run`);
        }
        const record = convertScriptRunToTaskRecord(scriptEvent.scriptRun);
        const refusal = getScriptReplayRefusal(record, recordedProjectFolder);
        if (refusal !== undefined) {
            return createRefusal(`${record.taskId}: ${refusal}`);
        }
        tasks.push({ record, instant: new Date(record.instant), waitingFiles: [{ relativePath, reason: ScriptReplayTaskReason.NamedByFile }] });
    }
    const olderState = states[gap.olderPosition]!;
    let startText = olderState.text;
    if (olderState.isFileAbsent) {
        startText = undefined;
    }
    return { kind: StopGapKind.Found, gap, startText, tasks };
}
