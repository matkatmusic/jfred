// For one file: the moments where its text is known, each with how sure we are.

import { computeRowUndo } from "./engineV3_replay_reverse.ts";
import { FileEventType, getEventBytes, isBeaconEvent, type FileEvent } from "./engineV3_replay_reverse_events.ts";

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
type TextKnowledge = ReturnType<typeof computeRowUndo>["textBefore"];
const UNKNOWN_TEXT: TextKnowledge = { isKnown: false, text: undefined };

type PendingState = { state: FileKnownState; isBehindRoadblock: boolean };

function createKnownText(text: string | undefined): TextKnowledge {
  return { isKnown: true, text };
}

function createProvenState(event: FileEvent, moment: StateMoment, text: string | undefined): FileKnownState {
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

// Walks from the newest event to the oldest; a beacon (a whole text) settles the states emitted since the last beacon.
export function listKnownStatesForFile(eventsNewestToOldest: FileEvent[]): FileKnownState[] {
  const knownStates: FileKnownState[] = [];
  let pendingStates: PendingState[] = [];
  let carried: TextKnowledge = UNKNOWN_TEXT;
  let isBehindRoadblock = false;
  for (const event of eventsNewestToOldest) {
    if (isBeaconEvent(event)) {
      const textAfter = getEventBytes(event);
      settlePendingStates(pendingStates, isCarriedTextEqualTo(carried, textAfter));
      knownStates.push(createProvenState(event, StateMoment.AtEvent, textAfter));
      carried = createKnownText(textAfter);
      if (event.row !== undefined) {
        carried = computeRowUndo(event.row, undefined).textBefore;
        if (carried.isKnown) {
          knownStates.push(createProvenState(event, StateMoment.BeforeEvent, carried.text));
        }
      }
      pendingStates = [];
      isBehindRoadblock = false;
      continue;
    }
    switch (event.type) {
      case FileEventType.EditRow: {
        const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, carried);
        knownStates.push(stateAtEvent);
        pendingStates.push({ state: stateAtEvent, isBehindRoadblock });
        let textBefore = UNKNOWN_TEXT;
        if (carried.isKnown) {
          textBefore = computeRowUndo(event.row!, carried.text).textBefore;
        }
        if (!textBefore.isKnown) {
          isBehindRoadblock = true;
        }
        const stateBeforeEvent = createUnprovenState(event, StateMoment.BeforeEvent, textBefore);
        knownStates.push(stateBeforeEvent);
        pendingStates.push({ state: stateBeforeEvent, isBehindRoadblock });
        carried = textBefore;
        break;
      }
      case FileEventType.ScriptMayWrite:
      case FileEventType.OtherRow: {
        // The roadblock's own state is tentative too: the event may have changed the file.
        isBehindRoadblock = true;
        const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, carried);
        knownStates.push(stateAtEvent);
        pendingStates.push({ state: stateAtEvent, isBehindRoadblock });
        break;
      }
      case FileEventType.ReadPartial:
      case FileEventType.ScriptReadOnly: {
        const stateAtEvent = createUnprovenState(event, StateMoment.AtEvent, carried);
        knownStates.push(stateAtEvent);
        pendingStates.push({ state: stateAtEvent, isBehindRoadblock });
        break;
      }
      default:
        throw new Error(`listKnownStatesForFile: no rule for the event type ${event.type}`);
    }
  }
  settlePendingStates(pendingStates, false);
  return knownStates;
}
