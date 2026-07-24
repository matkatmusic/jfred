// Task 220 — the STATIC half of the lineage-seed horizon: per-target lineage instants and the
// path strings the pre-script rename chain connects, plus the all-events instant axis the
// post-first-touch flood rule scans. Everything here is a pure function of the records array,
// cached per records identity; the run-relevance half (which probes the execution memo) lives
// in reconstruction_lineage_horizon.ts.

import { Path } from "./structures/domain.ts";
import { EventKind } from "./structures/vocabulary.ts";
import type { TranscriptRecord } from "./structures/envelope.ts";
import type { FileEvent } from "./reconstruction_engine.ts";
import { extractFileEvents } from "./reconstruction_extract.ts";
import { buildRenameChain, eventBelongsToLineage, resolveFinalPath } from "./reconstruction_lineage.ts";

export type LineageStaticInputs = { lineagePathStrings: string[]; ownInstantsMs: number[] };

type CorpusStaticState = {
    allEventInstantsMs: number[];
    inputsByTarget: Map<string, LineageStaticInputs>;
};

const staticStateByCorpus = new WeakMap<TranscriptRecord[], CorpusStaticState>();

function getCorpusStaticState(records: TranscriptRecord[]): CorpusStaticState {
    let state = staticStateByCorpus.get(records);
    if (state === undefined) {
        const instantsMs = extractFileEvents(records).map((event) => event.timestamp.getTime());
        state = {
            allEventInstantsMs: instantsMs.sort((a, b) => a - b),
            inputsByTarget: new Map<string, LineageStaticInputs>(),
        };
        staticStateByCorpus.set(records, state);
    }
    return state;
}

// The sorted instant of every static file event — the flood rule's axis.
export function getAllStaticEventInstantsMs(records: TranscriptRecord[]): number[] {
    return getCorpusStaticState(records).allEventInstantsMs;
}

// Every path string one event can connect: both sides of a rename or copy, else the target.
function collectEventPathStrings(event: FileEvent): string[] {
    if (event.kind === EventKind.rename) {
        return [event.from.toString(), event.to.toString()];
    }
    if (event.kind === EventKind.copy) {
        return [event.from.toString(), event.to.toString()];
    }
    return [event.target.toString()];
}

// The target's static lineage: the instants of its own events, and every path string its
// pre-script rename chain connects (script-proven moves are the run channel's job).
function buildStaticInputsForTarget(records: TranscriptRecord[], target: Path): LineageStaticInputs {
    const events = extractFileEvents(records);
    const renameChain = buildRenameChain(events);
    const finalTarget = resolveFinalPath(target, renameChain);
    const lineageEvents = events.filter((event) => eventBelongsToLineage(event, finalTarget, renameChain));
    const pathStrings = new Set<string>([target.toString(), finalTarget.toString()]);
    for (const event of lineageEvents) {
        collectEventPathStrings(event).forEach((pathString) => pathStrings.add(pathString));
    }
    return {
        lineagePathStrings: [...pathStrings],
        ownInstantsMs: lineageEvents.map((event) => event.timestamp.getTime()).sort((a, b) => a - b),
    };
}

export function getStaticInputsForTarget(records: TranscriptRecord[], target: Path): LineageStaticInputs {
    const inputsByTarget = getCorpusStaticState(records).inputsByTarget;
    let inputs = inputsByTarget.get(target.toString());
    if (inputs === undefined) {
        inputs = buildStaticInputsForTarget(records, target);
        inputsByTarget.set(target.toString(), inputs);
    }
    return inputs;
}

// The largest instant strictly before `beforeMs`, or -1 when nothing precedes it.
export function findLatestInstantBefore(sortedInstantsMs: number[], beforeMs: number): number {
    let low = 0;
    let high = sortedInstantsMs.length - 1;
    let latest = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (sortedInstantsMs[mid]! < beforeMs) {
            latest = sortedInstantsMs[mid]!;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return latest;
}
