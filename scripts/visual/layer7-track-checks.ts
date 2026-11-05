// Layer 7 session-column checks: placement, windowing, duplicates and the look of each record kind.

import { type HeadlessPage } from "./cdp.ts";
import { buildRulerMatchProbe } from "./layer4-probes.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import { LANE_STEP_PX } from "../../webapp/layer1-components/session-column/layer1-session-lanes.ts";
import {
  BLOCK_IDS, TOOL_IDS, countNodesWithClass, findColumnNode, isBlockColourOwnAlone, isBlockComplete, isBracketBesideLane, isBracketSpanning,
  isEveryIdUnique, isLetterSetExpected, isStampedWithPredecessor, isTrackBetween, isWindowed, listBlockNodes, listColumnIds, listMissingIds,
  type ColumnBracketFacts, type ColumnNodeFacts, type DuplicateFacts, type SessionDotColour, type TrackFacts, type WindowFacts,
} from "./layer7-facts.ts";
import {
  COLUMN_NODE_FACTS, COLUMN_PAIR_ID, DUPLICATE_FACTS, FULL_SCROLL_IDS, SCROLL_HOME, SESSION_DOT_COLOURS, TRACK_FACTS, TRACK_LABEL_COUNT,
  WINDOW_FACTS, buildBracketProbe, buildHideSettled, buildRecordDot, buildSetHideIgnored,
} from "./layer7-probes.ts";

const WAIT_MS = 10_000;
const BRACKET_TOLERANCE_PX = 2;
const MIN_PAIR_GAP_PX = 40;
const COLUMN_BRACKET = buildBracketProbe("document", `#annotation-track .abracket[data-pair-id="${COLUMN_PAIR_ID}"]`);

async function validatePlacement(page: HeadlessPage): Promise<void> {
  const track = await page.evaluate<TrackFacts>(TRACK_FACTS);
  reportCheck("L7 the session column is one sticky element between the ruler and the stage", isTrackBetween(track), track);
  const nodes = await page.evaluate<ColumnNodeFacts[]>(COLUMN_NODE_FACTS);
  reportCheck("L7 the 8 block records each have one node and each kind class appears once", isBlockComplete(nodes), nodes.length);
}

async function validateWindow(page: HeadlessPage): Promise<void> {
  const facts = await page.evaluate<WindowFacts>(WINDOW_FACTS);
  const total = listColumnIds().length;
  reportCheck(`L7 the column draws fewer than ${total} nodes at the top and at the bottom, and the two sets differ`, isWindowed(facts, total),
    [facts.topIds.length, facts.bottomIds.length]);
  reportCheck("L7 every drawn column node lies inside the pane plus the margin", facts.outsideCount === 0, facts.outsideCount);
}

async function validateFullScroll(page: HeadlessPage): Promise<string[]> {
  const seen = await page.evaluate<string[]>(FULL_SCROLL_IDS);
  const missing = listMissingIds(seen, listColumnIds());
  reportCheck(`L7 a full scroll draws all ${listColumnIds().length} column records`, missing.length === 0, missing);
  return seen;
}

async function validateNoDuplicates(page: HeadlessPage, seen: string[]): Promise<void> {
  const facts = await page.evaluate<DuplicateFacts>(DUPLICATE_FACTS);
  const isClean = facts.stageParts === 0 && facts.trackTools === 0 && isEveryIdUnique(facts.ids);
  reportCheck("L7 no record is drawn twice: none in the stage, no tool node in the column, unique ids", isClean, facts);
  const allIds = [...seen, ...TOOL_IDS];
  const isAllDistinct = isEveryIdUnique(allIds) && listMissingIds(facts.ids, TOOL_IDS).length === 0;
  reportCheck(`L7 the column ids and the tool ids make ${allIds.length} different records`, isAllDistinct, allIds.length);
}

export async function validateTrack(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await validatePlacement(page);
  await saveScreenshot(page, "15-layer7-column");
  console.log("L7 screenshot: scripts/visual/out/mockup-15-layer7-column.png");
  await validateWindow(page);
  await validateNoDuplicates(page, await validateFullScroll(page));
}

async function validateRulerMatch(page: HeadlessPage): Promise<void> {
  const unmatched: string[] = [];
  for (const id of [...BLOCK_IDS, ...TOOL_IDS]) {
    const isMatched = await page.evaluate<boolean>(buildRulerMatchProbe(buildRecordDot(id)));
    if (!isMatched)
      unmatched.push(id);
  }
  reportCheck("L7 every block node and both tool nodes sit level with a ruler tick", unmatched.length === 0, unmatched);
}

function isPairRight(nodes: ColumnNodeFacts[], bracket: ColumnBracketFacts): boolean {
  const use = findColumnNode(nodes, BLOCK_IDS[2]!);
  const result = findColumnNode(nodes, BLOCK_IDS[5]!);
  const hook = findColumnNode(nodes, BLOCK_IDS[3]!);
  // const isTyped = countNodesWithClass(nodes, "a-tool-use") === 1 && countNodesWithClass(nodes, "a-tool-result") === 1;
  const isTyped = use.classes.split(" ").includes("a-tool-use") && result.classes.split(" ").includes("a-tool-result");
  const isSamePair = use.pairId === COLUMN_PAIR_ID && result.pairId === COLUMN_PAIR_ID;
  const isApart = result.cy - use.cy >= MIN_PAIR_GAP_PX;
  const isHookBetween = hook.cy > use.cy && hook.cy < result.cy;
  const isBesideLane = isBracketBesideLane(bracket, [use, result], LANE_STEP_PX);
  return isTyped && isSamePair && isApart && isHookBetween && isBesideLane && isBracketSpanning(bracket, use.cy, result.cy, BRACKET_TOLERANCE_PX);
}

// function isUnknownRight(nodes: ColumnNodeFacts[]): boolean {
//   const node = findColumnNode(nodes, BLOCK_IDS[6]!);
//   const isOnce = countNodesWithClass(nodes, "a-unknown") === 1;
//   const hasText = node.label.includes("[?]") && node.label.includes("worktree-state");
//   return isOnce && hasText && node.borderStyle === "dashed";
// }

// The dot text is exactly `?`, the log text rides as data, and no .alabel exists.
function isUnknownRight(nodes: ColumnNodeFacts[], labelCount: number): boolean {
  const node = findColumnNode(nodes, BLOCK_IDS[6]!);
  const isOnce = countNodesWithClass(nodes, "a-unknown") === 1;
  const hasText = node.letter === "?" && node.recordLabel.includes("worktree-state");
  return isOnce && hasText && labelCount === 0;
}

// function isApart(one: PageBox, two: PageBox): boolean {
//   return one.right <= two.left || two.right <= one.left || one.bottom <= two.top || two.bottom <= one.top;
// }

// // Both label boxes have text, do not overlap each other, and no label box overlaps either node box.
// export function isLabelClear(first: ColumnNodeFacts, second: ColumnNodeFacts): boolean {
//   const hasText = first.labelBox.right > first.labelBox.left && second.labelBox.right > second.labelBox.left;
//   const isClearOfNodes = isApart(first.labelBox, first.nodeBox) && isApart(first.labelBox, second.nodeBox)
//     && isApart(second.labelBox, first.nodeBox) && isApart(second.labelBox, second.nodeBox);
//   return hasText && isApart(first.labelBox, second.labelBox) && isClearOfNodes;
// }

function isStamplessRight(nodes: ColumnNodeFacts[]): boolean {
  const isOnce = countNodesWithClass(nodes, "is-stampless") === 1;
  const stampless = findColumnNode(nodes, BLOCK_IDS[7]!);
  const predecessor = findColumnNode(nodes, BLOCK_IDS[6]!);
  return isOnce && isStampedWithPredecessor(stampless, predecessor);
}

async function validateColumnPair(page: HeadlessPage, nodes: ColumnNodeFacts[]): Promise<void> {
  const bracket = await page.evaluate<ColumnBracketFacts>(COLUMN_BRACKET);
  reportCheck("L7 the column tool pair: two dots, one pair id, 40px apart, a dashed bracket spanning them and left of both, the hook between", isPairRight(nodes, bracket), bracket);
  await page.evaluate(buildSetHideIgnored(true));
  await page.waitFor(buildHideSettled(true), WAIT_MS);
  const kept = await page.evaluate<ColumnBracketFacts>(COLUMN_BRACKET);
  const use = findColumnNode(nodes, BLOCK_IDS[2]!);
  const result = findColumnNode(nodes, BLOCK_IDS[5]!);
  const isKept = isBracketSpanning(kept, use.cy, result.cy, BRACKET_TOLERANCE_PX) && isBracketBesideLane(kept, [use, result], LANE_STEP_PX);
  reportCheck("L7 the column bracket stays, beside its lane, when ignored nodes are hidden", isKept, kept);
}

async function validateDotLooks(page: HeadlessPage, nodes: ColumnNodeFacts[]): Promise<void> {
  const block = listBlockNodes(nodes);
  const dotColours = await page.evaluate<SessionDotColour[]>(SESSION_DOT_COLOURS);
  const isLooksRight = isLetterSetExpected(block) && isBlockColourOwnAlone(block, dotColours);
  reportCheck("L7 the 8 block dots show the letters u a t r h m n ?, share one session colour, and no other session uses it", isLooksRight, dotColours);
  const labelCount = await page.evaluate<number>(TRACK_LABEL_COUNT);
  reportCheck("L7 the unknown dot reads exactly ?, carries the worktree-state log text, and the column draws no .alabel label", isUnknownRight(nodes, labelCount), labelCount);
  const stamplessDetail = [findColumnNode(nodes, BLOCK_IDS[6]!).nodeBox, findColumnNode(nodes, BLOCK_IDS[7]!).nodeBox];
  reportCheck("L7 the stampless dot shares its predecessor instant, is level with it, sits beside it at stack 1 with no dot overlap", isStamplessRight(nodes), stamplessDetail);
}

// Runs with hide ignored nodes off so every node has a box; it ends with the box on again.
export async function validateColumnNodes(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await page.evaluate(buildSetHideIgnored(false));
  await page.waitFor(buildHideSettled(false), WAIT_MS);
  const nodes = await page.evaluate<ColumnNodeFacts[]>(COLUMN_NODE_FACTS);
  await validateRulerMatch(page);
  await validateDotLooks(page, nodes);
  await validateColumnPair(page, nodes);
}
