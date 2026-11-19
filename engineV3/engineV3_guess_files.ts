// The one check of which files need guesses in the reconstruction, and the category that says why.

import { GuessCategory } from "../src/structures/vocabulary.ts";
import { StateConfidence, listKnownStatesForFile, type FileKnownState } from "./engineV3_file_known_states.ts";
import { isModifyingEventType } from "./engineV3_file_step.ts";
import { FileEventType, type FileEvent } from "./engineV3_replay_reverse_events.ts";

const GUESS_CONFIDENCES = [StateConfidence.Derived, StateConfidence.Unknown];

export type GuessFacts = {
    hasModifyingEventAfterBoundary: boolean;
    hasReadEventAfterBoundary: boolean;
    guessStateCount: number;
    isAbsentAtBoundary: boolean;
    lineCount: number;
    isPathNamedInLines: boolean;
};

export type EventsAfterBoundary = { hasModifyingEvent: boolean; hasReadEvent: boolean };

// Empty means the file has a clear walk.
export function listGuessStatesOfFile(events: FileEvent[]): FileKnownState[] {
    return listKnownStatesForFile(events).filter((state) => GUESS_CONFIDENCES.includes(state.confidence));
}

// An event after the boundary has no instant (DiskNow) or an instant later than the boundary: the commit at the boundary instant is not one.
export function describeEventsAfterBoundary(events: FileEvent[], boundaryInstant: Date | undefined): EventsAfterBoundary {
    const described: EventsAfterBoundary = { hasModifyingEvent: false, hasReadEvent: false };
    for (const event of events) {
        let isAfterBoundary = true;
        if (boundaryInstant !== undefined) {
            if (event.instant !== undefined) {
                isAfterBoundary = event.instant.getTime() > boundaryInstant.getTime();
            }
        }
        if (isAfterBoundary) {
            if (isModifyingEventType(event.type)) {
                described.hasModifyingEvent = true;
            } else {
                if (event.type !== FileEventType.DiskNow) {
                    described.hasReadEvent = true;
                }
            }
        }
    }
    return described;
}

// The checks run in this order; each returns at once. Undefined means a clear walk.
export function chooseGuessCategory(facts: GuessFacts): GuessCategory | undefined {
    if (facts.hasModifyingEventAfterBoundary) {
        if (facts.guessStateCount > 0) {
            return GuessCategory.HasGuessSteps;
        }
        return undefined;
    }
    if (facts.lineCount === 0) {
        return GuessCategory.NoLogLines;
    }
    if (!facts.isPathNamedInLines) {
        return GuessCategory.LogNamesOtherPath;
    }
    if (facts.isAbsentAtBoundary) {
        return GuessCategory.AbsentAtStartCommit;
    }
    if (facts.hasReadEventAfterBoundary) {
        return GuessCategory.NoChangingEvents;
    }
    return undefined;
}
