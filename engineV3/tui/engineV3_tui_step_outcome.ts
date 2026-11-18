// Maps the collected output of a finished step or play child to the outcome the terminal UI shows.

import { InverseStepOutcome, PlayOutcomeKind, StepProcessOutcomeKind } from "../../src/structures/vocabulary.ts";
import type { StepResultLine } from "../engineV3_step_start_at.ts";
import type { CrashedAtLine, PlayOutcome, StepProcessOutcome } from "./engineV3_tui_walk_types.ts";

export type ChildResult = { exitCode: number | null; signal: NodeJS.Signals | null; stdoutLines: string[]; stderrTail: string };
type ReplayLine = { outcome: InverseStepOutcome; reason: string | undefined };

const NO_RESULT_LINE_TEXT = "the process printed no result line";
const CRASHED_AT_LINE_START = '{"crashedAt":';

function isCrashedAtLine(line: string): boolean {
    return line.startsWith(CRASHED_AT_LINE_START);
}

function isJsonObjectLine(line: string): boolean {
    return line.startsWith("{");
}

function findCrashedAt(stdoutLines: string[]): CrashedAtLine | null {
    const crashedAtText = stdoutLines.find(isCrashedAtLine);
    if (crashedAtText === undefined) {
        return null;
    }
    return JSON.parse(crashedAtText).crashedAt as CrashedAtLine;
}

function computeCrashedStepOutcome(result: ChildResult, stderrTail: string): StepProcessOutcome {
    return { kind: StepProcessOutcomeKind.Crashed, exitCode: result.exitCode, signal: result.signal, crashedAt: findCrashedAt(result.stdoutLines), stderrTail };
}

export function computeStepOutcome(result: ChildResult): StepProcessOutcome {
    if (result.exitCode !== 0) {
        return computeCrashedStepOutcome(result, result.stderrTail);
    }
    const lastLineText = result.stdoutLines[result.stdoutLines.length - 1];
    if (lastLineText === undefined) {
        return computeCrashedStepOutcome(result, NO_RESULT_LINE_TEXT);
    }
    const lastLine = JSON.parse(lastLineText) as StepResultLine;
    switch (lastLine.outcome) {
        case InverseStepOutcome.AlreadyStored:
        case InverseStepOutcome.StartAtReached:
            return { kind: StepProcessOutcomeKind.Covered, lastLine };
        case InverseStepOutcome.NoOlderChange:
            return { kind: StepProcessOutcomeKind.Finished, lastLine };
        case InverseStepOutcome.UnknownOrRoadblock:
            if (lastLine.eventType === null) {
                throw new Error(`a stopped walk printed no event type: ${lastLineText}`);
            }
            return { kind: StepProcessOutcomeKind.Stopped, eventType: lastLine.eventType, source: lastLine.source, lastLine };
        default:
            throw new Error(`unexpected outcome in the last line: ${lastLineText}`);
    }
}

function parseReplayLine(lineText: string): ReplayLine {
    return JSON.parse(lineText) as ReplayLine;
}

function isReplayOutcomeLine(line: ReplayLine): boolean {
    return [InverseStepOutcome.Replayed, InverseStepOutcome.ReplayRefused].includes(line.outcome);
}

export function computePlayOutcome(result: ChildResult): PlayOutcome {
    if (result.exitCode !== 0) {
        return { kind: PlayOutcomeKind.Crashed, reasonText: result.stderrTail };
    }
    // const replayLine = result.stdoutLines.filter(isJsonObjectLine).map(parseReplayLine).findLast(isReplayOutcomeLine);
    const replayLines = result.stdoutLines.filter(isJsonObjectLine).map(parseReplayLine);
    let replayLine: ReplayLine | undefined = undefined;
    for (let index = replayLines.length - 1; index >= 0; index--) {
        const candidateLine = replayLines[index]!;
        if (isReplayOutcomeLine(candidateLine)) {
            replayLine = candidateLine;
            break;
        }
    }
    if (replayLine === undefined) {
        return { kind: PlayOutcomeKind.Crashed, reasonText: NO_RESULT_LINE_TEXT };
    }
    if (replayLine.outcome === InverseStepOutcome.Replayed) {
        return { kind: PlayOutcomeKind.Replayed, reasonText: undefined };
    }
    return { kind: PlayOutcomeKind.ReplayRefused, reasonText: replayLine.reason };
}
