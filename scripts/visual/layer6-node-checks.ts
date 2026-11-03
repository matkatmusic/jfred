// Layer 6 node-state checks: the 7 README.md script nodes, judged from computed styles on the fixture-mode page.

import { type HeadlessPage } from "./cdp.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";
import {
  COUNT_CONSOLES, COUNT_CONSOLE_BUTTONS, NEVER_PROVABLE_ID, NEVER_PROVABLE_RULE_COUNT, README_BUBBLE, README_NODE_FACTS,
  SHOW_BOX_KINDS, type NodeFacts,
} from "./layer6-probes.ts";
import {
  findNodeFacts, isExpectedNodeSet, isMismatchAlone, isStateFilterAbsent, listNodeClasses, listNodeSignatures, listNodeSizes,
  listUniqueValues,
} from "./layer6-node-facts.ts";

const STATE_CLASS_TOTAL = `document.querySelectorAll('[class*="run-state-"]').length`;
const SCROLL_TO_FIRST_NODE = `${README_BUBBLE}.querySelector('i.node.n-script').scrollIntoView({ block: 'center', inline: 'start' });
        document.getElementById('timelines').scrollBy(-190, 0)`;

async function validateBeforeOpen(page: HeadlessPage): Promise<void> {
  const total = await page.evaluate<number>(`${COUNT_CONSOLES} + ${COUNT_CONSOLE_BUTTONS}`);
  reportCheck("L6 before any open: no run console and no Open run console button", total === 0, total);
}

async function saveNodeScreenshot(page: HeadlessPage): Promise<void> {
  // inline start puts the node under the sticky ruler, so the script scrolls back left past it.
  await page.evaluate(SCROLL_TO_FIRST_NODE);
  await saveScreenshot(page, "12-layer6-node-states");
  console.log("L6 screenshot: scripts/visual/out/mockup-12-layer6-node-states.png");
}

async function validateNodeSet(page: HeadlessPage, nodes: NodeFacts[]): Promise<void> {
  const stateTotal = await page.evaluate<number>(STATE_CLASS_TOTAL);
  reportCheck("L6 the README.md bubble holds 7 script nodes: pending, 5 states, never-provable", isExpectedNodeSet(nodes), listNodeClasses(nodes));
  reportCheck("L6 exactly 5 nodes on the page carry a run-state class", stateTotal === 5, stateTotal);
}

function validateNodeLooks(nodes: NodeFacts[]): void {
  const sizes = listUniqueValues(listNodeSizes(nodes));
  // const isSameSize = sizes.length === 1 && nodes[0]?.width === 15;
  const isSameSize = sizes.length === 1 && nodes[0]?.width === 13;
  reportCheck("L6 all 7 are the same node: equal width and height", isSameSize, sizes);
  const signatures = listUniqueValues(listNodeSignatures(nodes));
  reportCheck("L6 the 7 nodes have 7 different computed looks", signatures.length === 7, signatures);
  reportCheck("L6 mismatch stands out: it alone has a double outline and a filled core", isMismatchAlone(nodes), nodes);
}

async function validateReuseAndFilters(page: HeadlessPage, nodes: NodeFacts[]): Promise<void> {
  const ruleCount = await page.evaluate<number>(NEVER_PROVABLE_RULE_COUNT);
  const neverProvable = findNodeFacts(nodes, NEVER_PROVABLE_ID);
  const isReused = ruleCount === 1 && neverProvable?.borderStyle === "dashed";
  reportCheck("L6 .never-provable is reused: one rule owns it and its node ring is dashed", isReused, ruleCount);
  const kinds = await page.evaluate<string[]>(SHOW_BOX_KINDS);
  reportCheck("L6 the Show row has no filter for states", isStateFilterAbsent(kinds), kinds);
}

export async function validateNodeStates(page: HeadlessPage): Promise<NodeFacts[]> {
  await validateBeforeOpen(page);
  await saveNodeScreenshot(page);
  const nodes = await page.evaluate<NodeFacts[]>(README_NODE_FACTS);
  await validateNodeSet(page, nodes);
  validateNodeLooks(nodes);
  await validateReuseAndFilters(page, nodes);
  return nodes;
}
