// For one file: the moments where its text is known, each with how sure we are.

import { applyEditToText, computeRowUndo, countOccurrences, type EditRow } from "./engineV3_replay_reverse.ts";
import { FileEventType, findNextOlderEventBytes, getEventBytes, isBeaconEvent, type FileEvent } from "./engineV3_replay_reverse_events.ts";
import { InverseStepEngine } from "../src/structures/vocabulary.ts";

export enum StateConfidence {
  Proven = "proven",
  Confirmed = "confirmed",
  Derived = "derived",
  Unknown = "unknown",
}

export enum StateMoment {
  AtEvent = "at-event",
  BeforeEvent = "before-event",
}

export type FileKnownState = {
  event: FileEvent;
  moment: StateMoment;
  confidence: StateConfidence;
  isFileAbsent: boolean;
  text: string | undefined;
};

// isKnown false means the text is not known; a known text of undefined means the file does not exist.
export type TextKnowledge = ReturnType<typeof computeRowUndo>["textBefore"];
const UNKNOWN_TEXT: TextKnowledge = { isKnown: false, text: undefined };

export type PendingState = { state: FileKnownState; isBehindRoadblock: boolean };

function createKnownText(text: string | undefined): TextKnowledge {
  return { isKnown: true, text };
}

export function createProvenState(event: FileEvent, moment: StateMoment, text: string | undefined): FileKnownState {
  return { event, moment, confidence: StateConfidence.Proven, isFileAbsent: text === undefined, text };
}

// Derived when the carried text is known, Unknown when it is not; a Derived state may be settled later.
function createUnprovenState(event: FileEvent, moment: StateMoment, carried: TextKnowledge): FileKnownState {
  if (!carried.isKnown) {
    return { event, moment, confidence: StateConfidence.Unknown, isFileAbsent: false, text: undefined };
  }
  return { event, moment, confidence: StateConfidence.Derived, isFileAbsent: carried.text === undefined, text: carried.text };
}

function isCarriedTextEqualTo(carried: TextKnowledge, text: string | undefined): boolean {
  if (!carried.isKnown) {
    return false;
  }
  return carried.text === text;
}

function settlePendingStates(pendingStates: PendingState[], isConfirmed: boolean): void {
  for (const pending of pendingStates) {
    if (pending.state.confidence === StateConfidence.Derived) {
      if (isConfirmed) {
        pending.state.confidence = StateConfidence.Confirmed;
      } else {
        if (pending.isBehindRoadblock) {
          pending.state.confidence = StateConfidence.Unknown;
          pending.state.isFileAbsent = false;
          pending.state.text = undefined;
        }
      }
    }
  }
}

// // Walks from the newest event to the oldest; a beacon (a whole text) settles the states emitted since the last beacon.
// export function listKnownStatesForFile(eventsNewestToOldest: FileEvent[]): FileKnownState[] {
//   const knownStates: FileKnownState[] = [];
//   let pendingStates: PendingState[] = [];
//   let carried: TextKnowledge = UNKNOWN_TEXT;
//   let isBehindRoadblock = false;
//   for (const [eventIndex, event] of eventsNewestToOldest.entries()) {
//     if (isBeaconEvent(event)) {
//       const textAfter = getEventBytes(event);
//       settlePendingStates(pendingStates, isCarriedTextEqualTo(carried, textAfter));
//       knownStates.push(createProvenState(event, StateMoment.AtEvent, textAfter));
//       carried = createKnownText(textAfter);
//       if (event.row !== undefined) {
//         carried = computeRowUndo(event.row, undefined).textBefore;
//         if (carried.isKnown) {
//           knownStates.push(createProvenState(event, StateMoment.BeforeEvent, carried.text));
//         }
//       }
//       pendingStates = [];
//       isBehindRoadblock = false;
//       continue;
//     }
//     switch (event.type) {
//       case FileEventType.EditRow: {
//         let textAtEvent = carried;
//         let textBefore = UNKNOWN_TEXT;
//         if (carried.isKnown) {
//           textBefore = computeRowUndo(event.row!, carried.text).textBefore;
//         }
//         if (!textBefore.isKnown) {
//           // The Edit cannot be undone from the newer text, so it is applied forward onto the next older beacon.
//           const older = findNextOlderEventBytes(eventsNewestToOldest, eventIndex);
//           const editRow = event.row as EditRow;
//           if (older.bytes !== undefined) {
//             if (!editRow.replaceAll) {
//               if (countOccurrences(older.bytes, editRow.oldString) === 1) {
//                 textBefore = createKnownText(older.bytes);
//                 textAtEvent = createKnownText(applyEditToText(older.bytes, editRow));
//               }
//             }
//           }
//         }
//         const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, textAtEvent);
//         knownStates.push(stateAtEvent);
//         pendingStates.push({ state: stateAtEvent, isBehindRoadblock });
//         if (!textBefore.isKnown) {
//           isBehindRoadblock = true;
//         }
//         const stateBeforeEvent = createUnprovenState(event, StateMoment.BeforeEvent, textBefore);
//         knownStates.push(stateBeforeEvent);
//         pendingStates.push({ state: stateBeforeEvent, isBehindRoadblock });
//         carried = textBefore;
//         break;
//       }
//       case FileEventType.ScriptMayWrite:
//       case FileEventType.OtherRow: {
//         // The roadblock's own state is tentative too: the event may have changed the file.
//         isBehindRoadblock = true;
//         let isGoneAfterEvent = event.removedByScript;
//         if (!isGoneAfterEvent) {
//           isGoneAfterEvent = event.movedAwayToFile !== undefined;
//         }
//         if (isGoneAfterEvent) {
//           // The command says the file is gone right after it: a guess, not pending, so no settle makes it Unknown.
//           knownStates.push({ event, moment: StateMoment.AtEvent, confidence: StateConfidence.Derived, isFileAbsent: true, text: undefined });
//           break;
//         }
//         const isOldestEvent = eventIndex === eventsNewestToOldest.length - 1;
//         let isBornTextKnown = false;
//         if (isOldestEvent) {
//           if (event.moveOrCopySourceFile !== undefined) {
//             if (event.bytes !== undefined) {
//               isBornTextKnown = true;
//             }
//           }
//         }
//         if (isBornTextKnown) {
//           // The born text is a guess, so it is not pending: no settle can turn it into Unknown.
//           knownStates.push({ event, moment: StateMoment.AtEvent, confidence: StateConfidence.Derived, isFileAbsent: false, text: event.bytes });
//         } else {
//           const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, carried);
//           knownStates.push(stateAtEvent);
//           pendingStates.push({ state: stateAtEvent, isBehindRoadblock });
//         }
//         if (event.moveOrCopySourceFile !== undefined) {
//           if (isOldestEvent) {
//             // A move or a copy can overwrite a file, so the absence before it is a guess.
//             knownStates.push({ event, moment: StateMoment.BeforeEvent, confidence: StateConfidence.Derived, isFileAbsent: true, text: undefined });
//           }
//         }
//         break;
//       }
//       case FileEventType.UserEditNotice: {
//         // The laid-over text is a guess, so it is not pending; the text before the notice is unknown.
//         knownStates.push({ event, moment: StateMoment.AtEvent, confidence: StateConfidence.Derived, isFileAbsent: false, text: event.bytes });
//         carried = UNKNOWN_TEXT;
//         isBehindRoadblock = true;
//         break;
//       }
//       case FileEventType.ReadPartial:
//       case FileEventType.ScriptReadOnly: {
//         const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, carried);
//         knownStates.push(stateAtEvent);
//         pendingStates.push({ state: stateAtEvent, isBehindRoadblock });
//         break;
//       }
//       default:
//         throw new Error(`listKnownStatesForFile: no rule for the event type ${event.type}`);
//     }
//   }
//   settlePendingStates(pendingStates, false);
//   return knownStates;
// }

export type FileWalk = {
    eventsNewestToOldest: FileEvent[];
    knownStates: FileKnownState[];
    pendingStates: PendingState[];
    carried: TextKnowledge;
    isBehindRoadblock: boolean;
};

export function createFileWalk(eventsNewestToOldest: FileEvent[]): FileWalk {
    return { eventsNewestToOldest, knownStates: [], pendingStates: [], carried: UNKNOWN_TEXT, isBehindRoadblock: false };
}

// One pass: the work for the event at eventIndex. Returns the engine that undid a partial Edit; undefined for any other event.
export function runPassOverEvent(walk: FileWalk, eventIndex: number): InverseStepEngine | undefined {
    const event = walk.eventsNewestToOldest[eventIndex]!;
    if (isBeaconEvent(event)) {
        const textAfter = getEventBytes(event);
        settlePendingStates(walk.pendingStates, isCarriedTextEqualTo(walk.carried, textAfter));
        walk.knownStates.push(createProvenState(event, StateMoment.AtEvent, textAfter));
        walk.carried = createKnownText(textAfter);
        if (event.row !== undefined) {
            walk.carried = computeRowUndo(event.row, undefined).textBefore;
            if (walk.carried.isKnown) {
                walk.knownStates.push(createProvenState(event, StateMoment.BeforeEvent, walk.carried.text));
            }
        }
        walk.pendingStates = [];
        walk.isBehindRoadblock = false;
        return undefined;
    }
    switch (event.type) {
        case FileEventType.EditRow: {
            let passEngine = InverseStepEngine.Backward;
            let textAtEvent = walk.carried;
            let textBefore = UNKNOWN_TEXT;
            if (walk.carried.isKnown) {
                textBefore = computeRowUndo(event.row!, walk.carried.text).textBefore;
            }
            if (!textBefore.isKnown) {
                // The Edit cannot be undone from the newer text, so it is applied forward onto the next older beacon.
                const older = findNextOlderEventBytes(walk.eventsNewestToOldest, eventIndex);
                const editRow = event.row as EditRow;
                if (older.bytes !== undefined) {
                    if (!editRow.replaceAll) {
                        if (countOccurrences(older.bytes, editRow.oldString) === 1) {
                            textBefore = createKnownText(older.bytes);
                            textAtEvent = createKnownText(applyEditToText(older.bytes, editRow));
                            passEngine = InverseStepEngine.Forward;
                        }
                    }
                }
            }
            const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, textAtEvent);
            walk.knownStates.push(stateAtEvent);
            walk.pendingStates.push({ state: stateAtEvent, isBehindRoadblock: walk.isBehindRoadblock });
            if (!textBefore.isKnown) {
                walk.isBehindRoadblock = true;
                passEngine = InverseStepEngine.BothFailed;
            }
            const stateBeforeEvent = createUnprovenState(event, StateMoment.BeforeEvent, textBefore);
            walk.knownStates.push(stateBeforeEvent);
            walk.pendingStates.push({ state: stateBeforeEvent, isBehindRoadblock: walk.isBehindRoadblock });
            walk.carried = textBefore;
            return passEngine;
        }
        case FileEventType.ScriptMayWrite:
        case FileEventType.OtherRow: {
            // The roadblock's own state is tentative too: the event may have changed the file.
            walk.isBehindRoadblock = true;
            let isGoneAfterEvent = event.removedByScript;
            if (!isGoneAfterEvent) {
                isGoneAfterEvent = event.movedAwayToFile !== undefined;
            }
            if (isGoneAfterEvent) {
                // The command says the file is gone right after it: a guess, not pending, so no settle makes it Unknown.
                walk.knownStates.push({ event, moment: StateMoment.AtEvent, confidence: StateConfidence.Derived, isFileAbsent: true, text: undefined });
                break;
            }
            const isOldestEvent = eventIndex === walk.eventsNewestToOldest.length - 1;
            let isBornTextKnown = false;
            if (isOldestEvent) {
                if (event.moveOrCopySourceFile !== undefined) {
                    if (event.bytes !== undefined) {
                        isBornTextKnown = true;
                    }
                }
            }
            if (isBornTextKnown) {
                // The born text is a guess, so it is not pending: no settle can turn it into Unknown.
                walk.knownStates.push({ event, moment: StateMoment.AtEvent, confidence: StateConfidence.Derived, isFileAbsent: false, text: event.bytes });
            } else {
                const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, walk.carried);
                walk.knownStates.push(stateAtEvent);
                walk.pendingStates.push({ state: stateAtEvent, isBehindRoadblock: walk.isBehindRoadblock });
            }
            if (event.moveOrCopySourceFile !== undefined) {
                if (isOldestEvent) {
                    // A move or a copy can overwrite a file, so the absence before it is a guess.
                    walk.knownStates.push({ event, moment: StateMoment.BeforeEvent, confidence: StateConfidence.Derived, isFileAbsent: true, text: undefined });
                }
            }
            break;
        }
        case FileEventType.UserEditNotice: {
            // The laid-over text is a guess, so it is not pending; the text before the notice is unknown.
            walk.knownStates.push({ event, moment: StateMoment.AtEvent, confidence: StateConfidence.Derived, isFileAbsent: false, text: event.bytes });
            walk.carried = UNKNOWN_TEXT;
            walk.isBehindRoadblock = true;
            break;
        }
        case FileEventType.ReadPartial:
        case FileEventType.ScriptReadOnly: {
            const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, walk.carried);
            walk.knownStates.push(stateAtEvent);
            walk.pendingStates.push({ state: stateAtEvent, isBehindRoadblock: walk.isBehindRoadblock });
            break;
        }
        default:
            throw new Error(`listKnownStatesForFile: no rule for the event type ${event.type}`);
    }
    return undefined;
}

export function finishFileWalk(walk: FileWalk): void {
    settlePendingStates(walk.pendingStates, false);
}

// Walks from the newest event to the oldest; a beacon (a whole text) settles the states emitted since the last beacon.
export function listKnownStatesForFile(eventsNewestToOldest: FileEvent[]): FileKnownState[] {
    const walk = createFileWalk(eventsNewestToOldest);
    for (const eventIndex of eventsNewestToOldest.keys()) {
        runPassOverEvent(walk, eventIndex);
    }
    finishFileWalk(walk);
    return walk.knownStates;
}

// Looks only at the first state older than the instant: a still older state is never used in its place.
export function getTextJustBeforeInstant(statesNewestToOldest: FileKnownState[], instant: Date): string | undefined {
  for (const state of statesNewestToOldest) {
    if (state.event.instant !== undefined) {
      if (state.event.instant.getTime() < instant.getTime()) {
        if (state.confidence === StateConfidence.Unknown) {
          return undefined;
        }
        if (state.isFileAbsent) {
          return undefined;
        }
        return state.text;
      }
    }
  }
  return undefined;
}
