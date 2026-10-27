// Layer 3 fixture lookups: small searches over one path's ordered events and hunks.

import { WireEditKind } from "../webapp/layer1-wire-edits.ts";
import { checkHunkMatchesBase } from "./layer1_edit_hunks.ts";
import type { FixtureEvent } from "./viewer_api_layer3_fixture_data.ts";

export function readEventContent(event: FixtureEvent): string[] {
  if (event.content === undefined) {
    throw new Error(`fixture event ${event.changeId} has no content`);
  }
  return event.content;
}

export function findEventIndex(events: FixtureEvent[], changeId: string): number {
  for (let index = 0; index < events.length; index += 1) {
    if (events[index]!.changeId === changeId) {
      return index;
    }
  }
  return -1;
}

export function findNextReadIndex(events: FixtureEvent[], startIndex: number): number {
  for (let index = startIndex; index < events.length; index += 1) {
    if (events[index]!.kind === WireEditKind.read) {
      return index;
    }
  }
  return -1;
}

export function isEveryHunkMatching(base: string[], hunks: NonNullable<FixtureEvent["hunks"]>): boolean {
  for (const hunk of hunks) {
    const isHunkMatching = checkHunkMatchesBase(base, hunk);
    if (!isHunkMatching) {
      return false;
    }
  }
  return true;
}
