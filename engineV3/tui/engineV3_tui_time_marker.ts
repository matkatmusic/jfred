// Stage B4: the project time marker, the jump speed and the folded ruler rows.

import type { Path } from "../../src/structures/domain.ts";
import { JumpSpeed, MarkerDirection } from "../../src/structures/vocabulary.ts";
import { formatInstantLabel, type RulerRow } from "../../webapp/layer1-components/ruler/layer1-ruler-rows.ts";
import type { ProjectEventEntry } from "./engineV3_tui_project_cache.ts";

export type TimeMarker = { instant: Date; eventIndex: number | undefined };
export type MarkerBounds = { newest: Date; oldest: Date };
export type MarkerMove = { marker: TimeMarker; steppedFile: Path | undefined };

const oneDay = 86_400_000;

function findNextEventIndex(events: ProjectEventEntry[], marker: TimeMarker, direction: MarkerDirection): number {
    if (marker.eventIndex !== undefined) {
        // if (direction === MarkerDirection.TowardsEarliest) {
        //     return marker.eventIndex + 1;
        // }
        // return marker.eventIndex - 1;
        const step = direction === MarkerDirection.TowardsEarliest ? 1 : -1;
        let nextIndex = marker.eventIndex + step;
        while (events[nextIndex]?.instant.getTime() === marker.instant.getTime()) {
            nextIndex += step;
        }
        return nextIndex;
    }
    if (direction === MarkerDirection.TowardsEarliest) {
        return events.findIndex((event) => event.instant.getTime() < marker.instant.getTime());
    }
    // return events.findLastIndex((event) => event.instant.getTime() > marker.instant.getTime());
    let lastNewerIndex = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
        // if (events[index].instant.getTime() > marker.instant.getTime()) {
        if (events[index]!.instant.getTime() > marker.instant.getTime()) {
            lastNewerIndex = index;
            break;
        }
    }
    return lastNewerIndex;
}

export function getNextNearestTimeStampEventForDirection(events: ProjectEventEntry[], marker: TimeMarker, direction: MarkerDirection): TimeMarker | undefined {
    const nextIndex = findNextEventIndex(events, marker, direction);
    if (nextIndex < 0) {
        return undefined;
    }
    if (nextIndex >= events.length) {
        return undefined;
    }
    // return { instant: events[nextIndex].instant, eventIndex: nextIndex };
    return { instant: events[nextIndex]!.instant, eventIndex: nextIndex };
}

function computeEventSpeedMove(events: ProjectEventEntry[], marker: TimeMarker, direction: MarkerDirection): MarkerMove {
    const nextMarker = getNextNearestTimeStampEventForDirection(events, marker, direction);
    if (nextMarker === undefined) {
        return { marker, steppedFile: undefined };
    }
    if (nextMarker.eventIndex === undefined) {
        throw new Error("the nearest event marker has no event index");
    }
    // return { marker: nextMarker, steppedFile: events[nextMarker.eventIndex].file };
    return { marker: nextMarker, steppedFile: events[nextMarker.eventIndex]!.file };
}

export function computeNextMarker(speed: JumpSpeed, events: ProjectEventEntry[], bounds: MarkerBounds, marker: TimeMarker, direction: MarkerDirection): MarkerMove {
    const signedOneDay = direction === MarkerDirection.TowardsNow ? oneDay : -oneDay;
    let nextTimestamp: number;
    if (speed === JumpSpeed.Event) {
        return computeEventSpeedMove(events, marker, direction);
    } else if (speed === JumpSpeed.Day) {
        nextTimestamp = marker.instant.getTime() + signedOneDay;
    } else if (speed === JumpSpeed.Week) {
        nextTimestamp = marker.instant.getTime() + 7 * signedOneDay;
    } else {
        throw new Error(`unknown jump speed ${speed}`);
    }
    const clampedTimestamp = Math.min(Math.max(nextTimestamp, bounds.oldest.getTime()), bounds.newest.getTime());
    return { marker: { instant: new Date(clampedTimestamp), eventIndex: undefined }, steppedFile: undefined };
}

export function foldEventsIntoRulerRows(events: ProjectEventEntry[], maxRowCount: number): RulerRow[] {
    const chunkSize = Math.ceil(events.length / maxRowCount);
    const rows: RulerRow[] = [];
    for (let chunkStart = 0; chunkStart < events.length; chunkStart += chunkSize) {
        const chunk = events.slice(chunkStart, chunkStart + chunkSize);
        const instantsNewestFirst = chunk.map((event) => event.instant.toISOString());
        // const label = formatInstantLabel(instantsNewestFirst[0]);
        const label = formatInstantLabel(instantsNewestFirst[0]!);
        rows.push({
            axisPx: 0,
            text: `${label} (${chunk.length})`,
            eventCount: chunk.length,
            axisPxList: chunk.map(() => 0),
            instants: instantsNewestFirst.reverse(),
        });
    }
    return rows;
}

export function listEventsOfFile(events: ProjectEventEntry[], file: Path): ProjectEventEntry[] {
    return events.filter((event) => event.file.value === file.value);
}

export function toggleJumpSpeed(current: JumpSpeed, pressed: JumpSpeed.Day | JumpSpeed.Week): JumpSpeed {
    if (current === pressed) {
        return JumpSpeed.Event;
    }
    return pressed;
}
