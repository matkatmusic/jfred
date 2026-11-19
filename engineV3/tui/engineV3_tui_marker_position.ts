// The marker box data of one file: its event instants, and the position of the file's time among them.

import type { ProjectEventEntry } from "./engineV3_tui_project_cache.ts";

// The events of one file from listEventsOfFile that are older than Now: the [now] column stands for Now and anything newer. Distinct instants, newest first.
export function listEventInstants(eventsOfFile: ProjectEventEntry[], nowTime: Date): Date[] {
    const instantTimes = new Set<number>();
    for (const event of eventsOfFile) {
        if (event.instant.getTime() < nowTime.getTime()) {
            instantTimes.add(event.instant.getTime());
        }
    }
    return [...instantTimes].sort((first, second) => second - first).map((instantTime) => new Date(instantTime));
}

// Position 0 is Now, position N is the Nth newest event. A time between two events marks the older event.
export function computeMarkedPosition(eventInstants: Date[], time: Date, nowTime: Date): number {
    if (time.getTime() >= nowTime.getTime()) {
        return 0;
    }
    for (const [index, eventInstant] of eventInstants.entries()) {
        if (eventInstant.getTime() <= time.getTime()) {
            return index + 1;
        }
    }
    return eventInstants.length;
}

// The time of the column to the left of the marked column: position 1 sits right of [now], and Now has no column to its left.
export function findNewerColumnTime(eventInstants: Date[], markedPosition: number, nowTime: Date): Date | undefined {
    if (markedPosition === 0) {
        return undefined;
    }
    if (markedPosition === 1) {
        return nowTime;
    }
    return eventInstants[markedPosition - 2];
}
