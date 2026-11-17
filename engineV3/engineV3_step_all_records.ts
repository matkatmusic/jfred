// The records of the --step-all walk: one per file, one summary, and the pieces that build them.

import { appendFileSync } from "node:fs";
import type { Path } from "../src/structures/domain.ts";
import { InverseStepEngine, InverseStepOutcome, StepAllRecordKind, StepAllReplayKind, StepAllVerdict } from "../src/structures/vocabulary.ts";
import { StateConfidence } from "./engineV3_file_known_states.ts";
import type { FileStep } from "./engineV3_file_step.ts";
import type { FileEvent, FileEventType } from "./engineV3_replay_reverse_events.ts";
import { formatSourceText } from "./engineV3_step_replay_command.ts";
import type { ReplayCommandOutput } from "./engineV3_step_replay_context.ts";

export type StepAllReplay =
    | { kind: StepAllReplayKind.Proven | StepAllReplayKind.Derived }
    | { kind: StepAllReplayKind.Refused | StepAllReplayKind.Failed; reason: string };

export type StepAllStop = { eventType: FileEventType; source: string | null; engine: InverseStepEngine | null; outcome: InverseStepOutcome; replay: StepAllReplay | null };
export type StepAllCrash = { message: string; stack: string; nextEventIndex: number | null; eventType: FileEventType | null; source: string | null };

export type StepAllFileRecord = {
    kind: StepAllRecordKind.File;
    file: string;
    verdict: StepAllVerdict;
    stepsForward: number;
    stepsBackward: number;
    stops: StepAllStop[];
    crash: StepAllCrash | null;
    backwardFailures: string[];
    seconds: number;
};

export type StepAllSummary = {
    kind: StepAllRecordKind.Summary;
    files: number;
    end: number;
    crash: number;
    bFailure: number;
    stopsByEventType: Record<string, number>;
    replay: { proven: number; derived: number; refused: Record<string, number>; failed: Record<string, number> };
    seconds: number;
};

export function getSecondsSince(startMilliseconds: number): number {
    return Math.round((Date.now() - startMilliseconds) / 100) / 10;
}

export function writeRecordLine(resultsFile: Path, record: StepAllFileRecord | StepAllSummary): void {
    const recordLine = JSON.stringify(record);
    appendFileSync(resultsFile.toString(), recordLine + "\n");
    console.log(recordLine);
}

export function parseReplayOutput(output: ReplayCommandOutput): StepAllReplay {
    const replayLine = JSON.parse(output.line) as { outcome: InverseStepOutcome; confidence?: StateConfidence; reason?: string };
    if (replayLine.outcome === InverseStepOutcome.Replayed) {
        if (replayLine.confidence === StateConfidence.Proven) {
            return { kind: StepAllReplayKind.Proven };
        }
        if (replayLine.confidence === StateConfidence.Derived) {
            return { kind: StepAllReplayKind.Derived };
        }
        throw new Error(`parseReplayOutput: the replayed line has the confidence ${replayLine.confidence}`);
    }
    if (replayLine.outcome !== InverseStepOutcome.ReplayRefused) {
        throw new Error(`parseReplayOutput: the replay line has the outcome ${replayLine.outcome}`);
    }
    if (output.isContainerFailure === true) {
        return { kind: StepAllReplayKind.Failed, reason: replayLine.reason! };
    }
    return { kind: StepAllReplayKind.Refused, reason: replayLine.reason! };
}

// step is undefined when the crash happens before the step exists.
export function createCrashRecord(error: Error, step: FileStep | undefined, events: FileEvent[]): StepAllCrash {
    if (step === undefined) {
        return { message: error.message, stack: error.stack!, nextEventIndex: null, eventType: null, source: null };
    }
    const crashedEvent = events[step.nextEventIndex];
    return { message: error.message, stack: error.stack!, nextEventIndex: step.nextEventIndex, eventType: crashedEvent?.type ?? null, source: formatSourceText(crashedEvent?.source) };
}

function addOneToCount(countByKey: Record<string, number>, key: string): void {
    countByKey[key] = (countByKey[key] ?? 0) + 1;
}

function countVerdict(fileRecords: StepAllFileRecord[], verdict: StepAllVerdict): number {
    return fileRecords.filter((fileRecord) => fileRecord.verdict === verdict).length;
}

export function createSummary(fileRecords: StepAllFileRecord[], seconds: number): StepAllSummary {
    const summary: StepAllSummary = {
        kind: StepAllRecordKind.Summary,
        files: fileRecords.length,
        end: countVerdict(fileRecords, StepAllVerdict.End),
        crash: countVerdict(fileRecords, StepAllVerdict.Crash),
        bFailure: countVerdict(fileRecords, StepAllVerdict.BackwardFailure),
        stopsByEventType: {},
        replay: { proven: 0, derived: 0, refused: {}, failed: {} },
        seconds,
    };
    for (const fileRecord of fileRecords) {
        for (const stop of fileRecord.stops) {
            addOneToCount(summary.stopsByEventType, stop.eventType);
            if (stop.replay?.kind === StepAllReplayKind.Proven) {
                summary.replay.proven += 1;
            }
            if (stop.replay?.kind === StepAllReplayKind.Derived) {
                summary.replay.derived += 1;
            }
            if (stop.replay?.kind === StepAllReplayKind.Refused) {
                addOneToCount(summary.replay.refused, stop.replay.reason);
            }
            if (stop.replay?.kind === StepAllReplayKind.Failed) {
                addOneToCount(summary.replay.failed, stop.replay.reason);
            }
        }
    }
    return summary;
}
