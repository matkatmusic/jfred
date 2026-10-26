// Layer 3 fixture data: crafted Read/Edit/Write events and the pure hunk helpers the bulk generator reuses.

import { WireEditKind } from "../webapp/layer1-wire-edits.ts";
import type { StructuredPatchHunk } from "./structures/tool-result-shapes.ts";
import { parseMs } from "./viewer_api_layer1_fixture_data.ts";
import { buildCraftedEvents } from "./viewer_api_layer3_fixture_crafted_events.ts";

export interface FixtureEventSpec { path: string; at: string; session: string; line: number; }

export interface FixtureEvent extends FixtureEventSpec {
  changeId: string;
  kind: WireEditKind;
  hunks?: StructuredPatchHunk[];
  content?: string[];
  expectDerived?: true;
}

const CONTEXT_LINES = 3;

let eventCount = 0;

function buildChangeId(): string {
  eventCount += 1;
  return `toolu_fixture_${String(eventCount).padStart(3, "0")}`;
}

export function buildReplaceHunk(base: string[], index: number, newLine: string): StructuredPatchHunk {
  const start = Math.max(0, index - CONTEXT_LINES);
  const end = Math.min(base.length, index + CONTEXT_LINES + 1);
  const lines: string[] = [];
  for (let at = start; at < end; at += 1) {
    if (at === index) {
      lines.push(`-${base[at]}`, `+${newLine}`);
    }
    else {
      lines.push(` ${base[at]}`);
    }
  }
  return { oldStart: start + 1, oldLines: end - start, newStart: start + 1, newLines: end - start, lines };
}

// Task 355: matchesBase and applyHunkLines moved to layer1_edit_hunks.ts as checkHunkMatchesBase and applyHunksToLines.
// export function matchesBase(base: string[], hunk: StructuredPatchHunk): boolean {
//   let cursor = hunk.oldStart - 1;
//   for (const row of hunk.lines) {
//     const isOldSide = !row.startsWith("+");
//     if (!isOldSide) {
//       continue;
//     }
//     if (base[cursor] !== row.slice(1)) {
//       return false;
//     }
//     cursor += 1;
//   }
//   return true;
// }
// export function applyHunkLines(base: string[], hunks: StructuredPatchHunk[]): string[] {
//   const result: string[] = [];
//   let cursor = 0;
//   for (const hunk of hunks) {
//     const hunkStart = hunk.oldStart - 1;
//     result.push(...base.slice(cursor, hunkStart));
//     cursor = hunkStart;
//     for (const row of hunk.lines) {
//       if (row.startsWith("+")) {
//         result.push(row.slice(1));
//         continue;
//       }
//       if (row.startsWith(" ")) {
//         result.push(base[cursor]!);
//       }
//       cursor += 1;
//     }
//   }
//   result.push(...base.slice(cursor));
//   return result;
// }

// // 343's tests still import the old names; re-point them to layer1_edit_hunks.ts, then drop this line.
// export { applyHunksToLines as applyHunkLines, checkHunkMatchesBase as matchesBase } from "./layer1_edit_hunks.ts";

function buildBaseEvent(kind: WireEditKind, spec: FixtureEventSpec): FixtureEvent {
  return { ...spec, changeId: buildChangeId(), kind };
}

export function buildReadEvent(spec: FixtureEventSpec, content: string[]): FixtureEvent {
  return { ...buildBaseEvent(WireEditKind.read, spec), content };
}

export function buildWriteEvent(spec: FixtureEventSpec, content: string[]): FixtureEvent {
  return { ...buildBaseEvent(WireEditKind.write, spec), content };
}

function buildHunkEvent(spec: FixtureEventSpec, hunkBase: string[], index: number, newLine: string): FixtureEvent {
  return { ...buildBaseEvent(WireEditKind.edit, spec), hunks: [buildReplaceHunk(hunkBase, index, newLine)] };
}

export function buildEditEvent(spec: FixtureEventSpec, base: string[], index: number): FixtureEvent {
  return buildHunkEvent(spec, base, index, `${base[index]}  // edited`);
}

// The hunk was cut against a base whose neighbouring line differs, so it cannot match the true base.
export function buildStaleEditEvent(spec: FixtureEventSpec, base: string[], index: number): FixtureEvent {
  const staleBase = [...base];
  const contextIndex = index > 0 ? index - 1 : index + 1;
  staleBase[contextIndex] += " (stale)";
  return { ...buildHunkEvent(spec, staleBase, index, `${base[index]}  // edited`), expectDerived: true };
}

// Bulk rows are appended here by buildBulkFixture when the layer 2 data module loads.
export const EDITS: FixtureEvent[] = buildCraftedEvents();

function compareByInstant(left: FixtureEvent, right: FixtureEvent): number {
  return parseMs(left.at) - parseMs(right.at);
}

export function listFixtureEvents(path: string): FixtureEvent[] {
  return EDITS.filter((event) => event.path === path).sort(compareByInstant);
}

export function findFixtureEvent(changeId: string): FixtureEvent {
  const found = EDITS.find((event) => event.changeId === changeId);
  if (found === undefined) {
    throw new Error(`no fixture event ${changeId}`);
  }
  return found;
}
