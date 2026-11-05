// Tests for validateOutcomes in layer6-outcome-checks.ts, using a fake page that follows the opened run and Cancel.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { validateOutcomes } from "../scripts/visual/layer6-outcome-checks.ts";
import { OUTCOME_CASES } from "../scripts/visual/layer6-popup-facts.ts";
import {
  CLICK_CANCEL, COUNT_CONSENT_DIALOGS, MISMATCH_ID, ORIGINAL_FAILED_ID, POPUP_FACTS, READ_FETCH_LOG, REPLAY_MISMATCH_ID, SKIP_AFTER_ID, SKIP_BASH_ID,
  SLOW_ID, VERIFIED_ID, type NodeFacts, type PopupFacts,
} from "../scripts/visual/layer6-probes.ts";
import { collectLines, createFakePage } from "./layer6-fake-page.ts";

const TOOL_USE_ID = /data-tool-use-id="([^"]+)"/;
const COLOURS: Record<string, string> = { "term-mismatch": "red", "term-original-failed": "grey", "term-cancelled": "silver" };

const BASE_POPUP: PopupFacts = {
  hidden: false, width: 300, height: 200, popupRect: [0, 0, 100, 50], stageRect: [0, 0, 500, 500], drawerRect: [120, 0, 400, 500],
  insideDrawer: false, drawerOpen: true, position: "absolute", insideStagewrap: true, overlapsTimelines: true,
  preCount: 1, preWhiteSpace: "pre", preText: "", noteTexts: [],
  cancelButtons: 1, cancelClass: "cancel-btn btn-idle", cancelDisabled: true, cancelBorderColor: "grey", cancelDecoration: "none",
  terminalClasses: [], terminalColours: [],
};

const buildNode = (id: string, borderColor: string, outlineColor: string): NodeFacts => ({
  id, classes: "", width: 1, height: 1, borderStyle: "", borderColor, borderWidth: "", outlineStyle: "", outlineColor, outlineWidth: "", backgroundImage: "",
});
const NODES = [buildNode(MISMATCH_ID, "red", ""), buildNode(VERIFIED_ID, "", "green"), buildNode(ORIGINAL_FAILED_ID, "", "grey")];

function buildOutcomePopup(id: string, wrongBlockId: string): PopupFacts {
  const outcome = OUTCOME_CASES.find((candidate) => candidate.id === id)!;
  const termClass = id === wrongBlockId ? "term-cancelled" : outcome.termClass;
  const terminalClasses = termClass === undefined ? [] : [termClass];
  const terminalColours = termClass === undefined ? [] : [COLOURS[termClass]!];
  return { ...BASE_POPUP, terminalClasses, terminalColours, noteTexts: outcome.note === undefined ? [] : [outcome.note] };
}

function buildSlowPopup(isCancelled: boolean, reads: number): PopupFacts {
  if (isCancelled)
    return { ...BASE_POPUP, preText: "step 1 of 6step 2 of 6", cancelClass: "cancel-btn btn-cancelled", cancelDecoration: "line-through", terminalClasses: ["term-cancelled"] };
  const preText = reads === 0 ? "step 1 of 6" : "step 1 of 6step 2 of 6step 3 of 6";
  return { ...BASE_POPUP, preText, cancelClass: "cancel-btn btn-live", cancelDisabled: false, cancelBorderColor: "red" };
}

function buildAnswers(wrongBlockId: string): (expression: string) => unknown {
  let currentId = "";
  let isCancelled = false;
  let slowReads = 0;
  return (expression: string): unknown => {
    if (expression.includes(".click()") && TOOL_USE_ID.test(expression)) currentId = TOOL_USE_ID.exec(expression)![1]!;
    if (expression === CLICK_CANCEL) isCancelled = true;
    if (expression === POPUP_FACTS) return currentId === SLOW_ID ? buildSlowPopup(isCancelled, slowReads++ === 0 ? 0 : 1) : buildOutcomePopup(currentId, wrongBlockId);
    if (expression === READ_FETCH_LOG) return [{ path: "/api/layer1-script-run", body: JSON.stringify({ toolUseId: SKIP_AFTER_ID }) }];
    if (expression === COUNT_CONSENT_DIALOGS) return 0;
    if (expression.endsWith(".className")) return OUTCOME_CASES.find((outcome) => expression.includes(outcome.id))?.stateClass ?? "node n-script";
    if (expression.includes("reply.needs")) return [];
    return undefined;
  };
}

async function runOutcomes(wrongBlockId: string): Promise<string[]> {
  const fake = createFakePage(buildAnswers(wrongBlockId));
  return collectLines(() => validateOutcomes(fake.page, NODES, "green"));
}

const listFailedChecks = (lines: string[]): string[] => lines.filter((line) => line.startsWith("FAIL")).map((line) => line.split("  ")[1] ?? "");

test("validateOutcomes passes all twelve checks on a good page", async () => {
  const lines = await runOutcomes("");
  assert.equal(lines.filter((line) => line.startsWith("PASS")).length, 12);
  assert.deepEqual(listFailedChecks(lines), []);
});

test("a wrong terminal block fails that outcome only, and no other outcome", async () => {
  const lines = await runOutcomes(REPLAY_MISMATCH_ID);
  const failed = listFailedChecks(lines);
  assert.equal(failed.length, 1);
  assert.ok(failed.includes("L6 the mismatch run shows the right terminal block, note and node state"));
  // assert.ok(failed.some((name) => name.startsWith("L6 node and console read as one event")));
});

test("a bash dot with a state class or a run post fails the bash check only", async () => {
  const answers = buildAnswers("");
  const fake = createFakePage((expression) => (expression.endsWith(".className") && expression.includes(SKIP_BASH_ID)) ? "node n-script run-state-verified" : answers(expression));
  const lines = await collectLines(() => validateOutcomes(fake.page, NODES, "green"));
  assert.deepEqual(listFailedChecks(lines), ["L6 an earlier bash dot never runs and gets no node state"]);
});
