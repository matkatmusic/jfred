import { InverseStepEngine, InverseStepOutcome } from "../src/structures/vocabulary.ts";
import { StateConfidence, type FileKnownState, createFileWalk, runPassOverEvent, finishFileWalk, type FileWalk } from "./engineV3_file_known_states.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import type { InverseCommit, OrderedKnownState } from "./engineV3_inverse_repo.ts";

type QueuedState = { position: number; passIndex: number; engine: InverseStepEngine | undefined; isRoadblockEntry: boolean };
// eventType and source name the event of the judged state (S6); both are undefined for NoOlderChange and Paused, which judge no state.
type StepStop = { outcome: InverseStepOutcome; writtenState: OrderedKnownState | undefined; engine: InverseStepEngine | undefined; eventType: FileEventType | undefined; source: FileEvent["source"] };
export type WrittenCommit = Pick<InverseCommit, "position" | "confidence" | "isFileAbsent" | "text" | "eventType" | "moment">;

export type ChangedLabel = { position: number; confidence: StateConfidence };
export type FileStepResult = StepStop & { changedLabels: ChangedLabel[] };

export type FileStep = {
    walk: FileWalk;
    nextEventIndex: number;
    queue: QueuedState[];                                   // states a pass pushed that no click has judged yet
    lastWrittenPosition: number;
    lastWrittenIsFileAbsent: boolean;                       // copied at write time: a later settle can clear the state's own text
    lastWrittenText: string | undefined;
    writtenConfidenceByPosition: Map<number, StateConfidence>;
    lastUnknownStopPassIndex: number | undefined;           // the pass whose Unknown state stopped a click last (S5)
    isFinished: boolean;
};

const MODIFYING_EVENT_TYPES: FileEventType[] = [
    FileEventType.WriteRow, FileEventType.EditRow, FileEventType.GitCommit, FileEventType.BackupSnapshot,
    FileEventType.ScriptMayWrite, FileEventType.OtherRow, FileEventType.UserEditNotice,
];
// GitCommit and BackupSnapshot count as modifying because the full build writes them as commits. ReadWhole does not (R1 skips reads); a ReadWhole with a different text still writes a commit when its pass is judged.

export function isModifyingEventType(eventType: FileEventType): boolean {
    return MODIFYING_EVENT_TYPES.includes(eventType);
}

export function findNextChangeInstant(eventsNewestToOldest: FileEvent[], step: FileStep | undefined): Date | undefined {
    let firstEventIndex = 0;
    if (step !== undefined) {
        const queuedState = step.queue[0];
        if (queuedState !== undefined) {
            return step.walk.knownStates[queuedState.position]!.event.instant;
        }
        firstEventIndex = step.nextEventIndex;
    }
    for (let eventIndex = firstEventIndex; eventIndex < eventsNewestToOldest.length; eventIndex += 1) {
        const event = eventsNewestToOldest[eventIndex]!;
        if (isModifyingEventType(event.type)) {
            return event.instant;
        }
    }
    return undefined;
}

function enqueueNextPass(step: FileStep): void {
    const firstNewPosition = step.walk.knownStates.length;
    const wasBehindRoadblock = step.walk.isBehindRoadblock;
    const passIndex = step.nextEventIndex;
    const engine = runPassOverEvent(step.walk, passIndex);
    step.nextEventIndex += 1;
    // A both-failed Edit already stops through its Unknown state, so it is not a second roadblock stop.
    const isRoadblockEntry = !wasBehindRoadblock && step.walk.isBehindRoadblock && engine !== InverseStepEngine.BothFailed;
    for (let position = firstNewPosition; position < step.walk.knownStates.length; position += 1) {
        step.queue.push({ position, passIndex, engine, isRoadblockEntry });
    }
}

// The confidence is not compared: a label may change after the write (see changedLabels). The instant is not compared: the DiskNow commit holds the disk modified time.
function validateWrittenCommitAgainstReplay(step: FileStep, writtenCommit: WrittenCommit): void {
    const replayedState = step.walk.knownStates[writtenCommit.position]!;
    // A later beacon settled this state to Unknown: the stored commit keeps its old label (user ruling).
    if (replayedState.confidence === StateConfidence.Unknown) {
        return;
    }
    const mismatchMessage = `stored commit ${writtenCommit.position} does not match the replayed state: start again from now`;
    if (replayedState.isFileAbsent !== writtenCommit.isFileAbsent) {
        throw new Error(mismatchMessage);
    }
    if (replayedState.text !== writtenCommit.text) {
        throw new Error(mismatchMessage);
    }
    if (replayedState.event.type !== writtenCommit.eventType) {
        throw new Error(mismatchMessage);
    }
    if (replayedState.moment !== writtenCommit.moment) {
        throw new Error(mismatchMessage);
    }
}

// writtenCommits: the commits already stored, first = position 0 (DiskNow), last = the tip.
// Intent (S1): a code fix or a new log line can change the replayed states; a stored commit that no longer matches must stop the restart, not move the tip.
export function createFileStep(eventsNewestToOldest: FileEvent[], writtenCommits: WrittenCommit[]): FileStep {
    const tipCommit = writtenCommits[writtenCommits.length - 1]!;
    const step: FileStep = {
        walk: createFileWalk(eventsNewestToOldest),
        nextEventIndex: 0,
        queue: [],
        lastWrittenPosition: tipCommit.position,
        lastWrittenIsFileAbsent: tipCommit.isFileAbsent,
        lastWrittenText: tipCommit.text,
        writtenConfidenceByPosition: new Map(writtenCommits.map((commit) => [commit.position, commit.confidence])),
        lastUnknownStopPassIndex: undefined,
        isFinished: false,
    };
    while (step.walk.knownStates.length <= step.lastWrittenPosition) {
        if (step.nextEventIndex === eventsNewestToOldest.length) {
            throw new Error(`createFileStep: the events end before the stored position ${step.lastWrittenPosition}`);
        }
        enqueueNextPass(step);
    }
    const tipState = step.walk.knownStates[step.lastWrittenPosition]!;
    if (tipState.confidence === StateConfidence.Derived) {
        if (tipState.text !== tipCommit.text) {
            while (step.walk.pendingStates.length > 0) {
                if (step.nextEventIndex === eventsNewestToOldest.length) {
                    break;
                }
                enqueueNextPass(step);
            }
            if (step.nextEventIndex === eventsNewestToOldest.length) {
                finishFileWalk(step.walk);
                step.isFinished = true;
            }
        }
    }
    for (const writtenCommit of writtenCommits) {
        validateWrittenCommitAgainstReplay(step, writtenCommit);
    }
    while (step.queue.length > 0) {
        if (step.queue[0]!.position > step.lastWrittenPosition) {
            break;
        }
        step.queue.shift();
    }
    return step;
}

function isStateTextSameAsLastWritten(step: FileStep, state: FileKnownState): boolean {
    if (state.isFileAbsent !== step.lastWrittenIsFileAbsent) {
        return false;
    }
    return state.text === step.lastWrittenText;
}

function judgeQueuedState(step: FileStep, queuedState: QueuedState): StepStop | undefined {
    if (queuedState.position <= step.lastWrittenPosition) {
        return undefined;
    }
    const state = step.walk.knownStates[queuedState.position]!;
    if (state.confidence === StateConfidence.Unknown) {
        if (step.lastUnknownStopPassIndex === queuedState.passIndex) {
            return undefined;
        }
        step.lastUnknownStopPassIndex = queuedState.passIndex;
        return { outcome: InverseStepOutcome.UnknownOrRoadblock, writtenState: undefined, engine: queuedState.engine, eventType: state.event.type, source: state.event.source };
    }
    if (isStateTextSameAsLastWritten(step, state)) {
        if (queuedState.isRoadblockEntry) {
            return { outcome: InverseStepOutcome.UnknownOrRoadblock, writtenState: undefined, engine: queuedState.engine, eventType: state.event.type, source: state.event.source };
        }
        return undefined;
    }
    step.lastWrittenPosition = queuedState.position;
    step.lastWrittenIsFileAbsent = state.isFileAbsent;
    step.lastWrittenText = state.text;
    step.writtenConfidenceByPosition.set(queuedState.position, state.confidence);
    let outcome = InverseStepOutcome.NewText;
    if (state.isFileAbsent) {
        outcome = InverseStepOutcome.FileAbsent;
    }
    return { outcome, writtenState: { state, position: queuedState.position }, engine: queuedState.engine, eventType: state.event.type, source: state.event.source };
}

// Intent (S4): a run-on past same-text events must not carry the line past a nearer file. The bound is the next-change instant of the second-nearest candidate file.
function isNextEventOlderThanBound(step: FileStep, boundInstant: Date | undefined): boolean {
    if (boundInstant === undefined) {
        return false;
    }
    const nextInstant = step.walk.eventsNewestToOldest[step.nextEventIndex]!.instant;
    if (nextInstant === undefined) {
        return false;
    }
    return nextInstant.getTime() < boundInstant.getTime();
}

function tryRunNextPass(step: FileStep, boundInstant: Date | undefined): StepStop | undefined {
    if (step.nextEventIndex < step.walk.eventsNewestToOldest.length) {
        if (isNextEventOlderThanBound(step, boundInstant)) {
            return { outcome: InverseStepOutcome.Paused, writtenState: undefined, engine: undefined, eventType: undefined, source: undefined };
        }
        enqueueNextPass(step);
        return undefined;
    }
    if (!step.isFinished) {
        finishFileWalk(step.walk);
        step.isFinished = true;
    }
    return { outcome: InverseStepOutcome.NoOlderChange, writtenState: undefined, engine: undefined, eventType: undefined, source: undefined };
}

function listChangedLabels(step: FileStep): ChangedLabel[] {
    const changedLabels: ChangedLabel[] = [];
    for (const [position, writtenConfidence] of step.writtenConfidenceByPosition) {
        const currentConfidence = step.walk.knownStates[position]!.confidence;
        if (currentConfidence !== writtenConfidence) {
            changedLabels.push({ position, confidence: currentConfidence });
            step.writtenConfidenceByPosition.set(position, currentConfidence);
        }
    }
    return changedLabels;
}

export function stepFileToNextTextChange(step: FileStep, boundInstant: Date | undefined): FileStepResult {
    let stop: StepStop | undefined;
    while (stop === undefined) {
        const queuedState = step.queue.shift();
        if (queuedState === undefined) {
            stop = tryRunNextPass(step, boundInstant);
        } else {
            stop = judgeQueuedState(step, queuedState);
        }
    }
    if (stop.outcome === InverseStepOutcome.Paused) {
        // A pause is never shown, so the label changes stay unreported until the next shown result.
        return { ...stop, changedLabels: [] };
    }
    return { ...stop, changedLabels: listChangedLabels(step) };
}
