// Canned L7 fixture: session-column records and one bubble's tool nodes (task 382, fixture mode only).

import { Uuid } from "./structures/domain.ts";
import { WireRecordKind, type WireAnnotationOf, type WireToolNodeOf } from "../webapp/layer1-wire-annotations.ts";
import type { Layer1WireView } from "./viewer_api_layer1.ts";
import { parseMs } from "./viewer_api_layer1_fixture_data.ts";

type Annotation = WireAnnotationOf<Date, Uuid>;
type ToolNode = WireToolNodeOf<Date, Uuid>;
type Ruler = Layer1WireView["ruler"];
type CannedRecord = Omit<Annotation, "id" | "instant">;

const FILLER_COUNT = 60;
const BLOCK_START_AT = "2026-06-01T08:44:00Z";
const BASH_PAIR_ID = new Uuid("toolu_fixture_l7_bash");
const GREP_PAIR_ID = new Uuid("toolu_fixture_l7_grep");

// In log order; the block has no instants: they come from the ruler ticks.
const BLOCK_RECORDS: CannedRecord[] = [
  { kind: WireRecordKind.user, label: "fix the trim bug" },
  { kind: WireRecordKind.assistant, label: "running the tests" },
  { kind: WireRecordKind.toolUse, label: "Bash: npm test", pairId: BASH_PAIR_ID },
  { kind: WireRecordKind.attachment, label: "hook_success", isIgnored: true },
  { kind: WireRecordKind.permissionMode, label: "acceptEdits", isIgnored: true },
  { kind: WireRecordKind.toolResult, label: "3 passed", pairId: BASH_PAIR_ID },
  { kind: WireRecordKind.unknown, label: "worktree-state" },
  { kind: WireRecordKind.customTitle, label: "trim fix", isStampless: true },
];

function listIdsWithPrefix(prefix: string, count: number, digits: number): Uuid[] {
  const ids: Uuid[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(new Uuid(`${prefix}${String(index).padStart(digits, "0")}`));
  }
  return ids;
}

export const ANNOTATION_BLOCK_IDS: Uuid[] = listIdsWithPrefix("l7-block-", BLOCK_RECORDS.length, 1);

export function listFillerIds(): Uuid[] {
  return listIdsWithPrefix("l7-fill-", FILLER_COUNT, 2);
}

function findBlockStart(ruler: Ruler): number {
  const blockStartMs = parseMs(BLOCK_START_AT);
  let start = ruler.length;
  for (let index = ruler.length - 1; index >= 0; index -= 1) {
    const isAtOrAfterStart = ruler[index]!.instant.getTime() >= blockStartMs;
    if (isAtOrAfterStart) {
      start = index;
    }
  }
  const hasRoomForBlock = start + BLOCK_RECORDS.length <= ruler.length;
  if (!hasRoomForBlock) {
    throw new Error(`the ruler has no room for the ${BLOCK_RECORDS.length}-record block from ${BLOCK_START_AT}`);
  }
  return start;
}

function fillStamplessInstants(rows: Annotation[]): Annotation[] {
  const filled: Annotation[] = [];
  for (const [index, row] of rows.entries()) {
    const isStampless = row.isStampless === true;
    filled.push(isStampless ? { ...row, instant: rows[index - 1]!.instant } : row);
  }
  return filled;
}

function buildBlockAnnotations(ruler: Ruler, start: number): Annotation[] {
  const rows: Annotation[] = [];
  for (const [index, record] of BLOCK_RECORDS.entries()) {
    rows.push({ ...record, id: ANNOTATION_BLOCK_IDS[index]!, instant: ruler[start + index]!.instant });
  }
  return fillStamplessInstants(rows);
}

function buildFillerAnnotations(ruler: Ruler, firstTick: number): Annotation[] {
  const span = ruler.length - firstTick;
  const rows: Annotation[] = [];
  for (const [index, id] of listFillerIds().entries()) {
    const isUser = index % 2 === 0;
    const kind = isUser ? WireRecordKind.user : WireRecordKind.assistant;
    const instant = ruler[firstTick + Math.floor((index * span) / FILLER_COUNT)]!.instant;
    rows.push({ id, kind, instant, label: `${isUser ? "prompt" : "reply"} ${index}` });
  }
  return rows;
}

export function buildFixtureAnnotations(ruler: Ruler): Annotation[] {
  const start = findBlockStart(ruler);
  return [...buildBlockAnnotations(ruler, start), ...buildFillerAnnotations(ruler, start + BLOCK_RECORDS.length)];
}

export const TOOL_NODE_PATH = "src/components/interim-run-scenario/test_run_scenario_dispatcher.ts";

const TOOL_NODE_ROWS = [
  { id: new Uuid("l7-tool-0"), kind: WireRecordKind.toolUse, label: 'Grep "dispatch"', instant: new Date(parseMs("2026-07-21T10:00:00Z")) },
  { id: new Uuid("l7-tool-1"), kind: WireRecordKind.toolResult, label: "4 matches", instant: new Date(parseMs("2026-07-22T10:00:00Z")) },
];

export const TOOL_NODE_IDS: Uuid[] = [TOOL_NODE_ROWS[0]!.id, TOOL_NODE_ROWS[1]!.id];

export function listToolNodeInstants(path: string): Date[] {
  const instants: Date[] = [];
  if (path !== TOOL_NODE_PATH) {
    return instants;
  }
  for (const row of TOOL_NODE_ROWS) {
    instants.push(row.instant);
  }
  return instants;
}

export function placeToolNodes(path: string, offsetsPx: number[]): ToolNode[] {
  const placed: ToolNode[] = [];
  if (path !== TOOL_NODE_PATH) {
    return placed;
  }
  for (const [index, row] of TOOL_NODE_ROWS.entries()) {
    placed.push({ ...row, pairId: GREP_PAIR_ID, axisPx: offsetsPx[index]! });
  }
  return placed;
}
