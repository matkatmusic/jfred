// Ruler UI session column runs for mockup 3: the page steps that feed the judges in ruler-ui-session-checks.ts.

import { ANNOTATION_BLOCK_IDS, listFillerIds } from "../../src/viewer_api_layer7_fixture_data.ts";
import { ANNOTATION_MID_IDS, ANNOTATION_SAME_ID, FIXTURE_LOG_SESSIONS } from "../../src/viewer_api_layer7_fixture_sessions.ts";
import { type HeadlessPage } from "./cdp.ts";
import { isBracketSpanning, type BracketFacts } from "./layer7-facts.ts";
import { findSessionEndIds } from "./layer7-session-ends.ts";
import { COLUMN_PAIR_ID, SCROLL_HOME, buildBracketProbe, buildRecordDot } from "./layer7-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { isRowsPlain, isRowTextRight, reportFacts, shootRulerState } from "./ruler-ui-checks.ts";
import {
  COLOUR_FACTS, OFF_FACTS, RULER_UI_SCREENSHOTS, SESSION_FACTS, SESSION_SCAN, STAGE_LEFT, TICK_TEXT_FACTS,
  buildDotCentre, buildHoverProbe, buildLineProbe, buildMidProbe, buildSameInstantProbe, buildScrollToDot,
} from "./ruler-ui-probes.ts";
import {
  APART_PX, FIRST_ID, FIRST_SESSION_ID, isBetweenTicks, isEveryDotLetterRight, isEverySessionColourRight, isLineEndAt, isLineStartAt, isPopupRight,
  isSameInstantRight, isSessionOff, isStageShifted, isToggleGreen, isTrackPlaced, toggleSessionColumn,
  type LineFacts, type OffFacts, type SameFacts, type ScanFacts,
} from "./ruler-ui-session-checks.ts";

const LAST_ID = findSessionEndIds(FIXTURE_LOG_SESSIONS[0]!.id).lastId;
const FILL_8 = String(listFillerIds()[8]);
const FILL_40 = String(listFillerIds()[40]);
const BRACKET_SELECTOR = `.abracket[data-pair-id="${COLUMN_PAIR_ID}"]`;

async function validateTrack(page: HeadlessPage, offLeft: number): Promise<void> {
  await page.evaluate(buildScrollToDot(FILL_8));
  const facts = await reportFacts(page, SESSION_FACTS, "RULER session: the button is current and green", isToggleGreen);
  reportCheck("RULER session: the track touches the ruler and is 74px wide for 3 lanes, below 100px", isTrackPlaced(facts), facts);
  reportCheck("RULER session: three overlapping sessions use three different columns", facts.laneXs.length === 3, facts.laneXs);
  reportCheck("RULER session: the stage moves right by exactly the track width", isStageShifted(offLeft, facts), [offLeft, facts.stageLeft]);
}

async function validateScan(page: HeadlessPage): Promise<void> {
  const scan = await page.evaluate<ScanFacts>(SESSION_SCAN);
  reportCheck("RULER session: every dot reads one letter of u a t r h m n ?, with no title and no old label", isEveryDotLetterRight(scan), scan.letters);
  reportCheck("RULER session: 4 sessions have 4 colors, one per session, and 418 rows take them", isEverySessionColourRight(scan), scan.colours);
}

async function validateLines(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await reportFacts(page, buildLineProbe(FIRST_SESSION_ID, FIRST_ID), "RULER session: the first session line starts at its first dot", isLineStartAt);
  await page.evaluate(buildScrollToDot(LAST_ID));
  const first = await reportFacts(page, buildLineProbe(FIRST_SESSION_ID, LAST_ID), "RULER session: the first session line ends at its last dot", isLineEndAt);
  await page.evaluate(buildScrollToDot(FILL_40));
  const later = await page.evaluate<LineFacts>(buildLineProbe(String(FIXTURE_LOG_SESSIONS[3]!.id), FILL_40));
  reportCheck("RULER session: a session that starts later shares the first column", later.laneX === first.laneX, [first, later]);
}

async function validateBetweenAndSame(page: HeadlessPage): Promise<void> {
  await page.evaluate(buildScrollToDot(FILL_8));
  const same = await page.evaluate<SameFacts>(buildSameInstantProbe(String(listFillerIds()[7]), String(ANNOTATION_SAME_ID)));
  reportCheck("RULER session: two sessions at one instant sit side by side and the row stays plain", isSameInstantRight(same), same);
  await page.evaluate(buildScrollToDot(String(ANNOTATION_MID_IDS[0])));
  await reportFacts(page, buildMidProbe(String(ANNOTATION_MID_IDS[0])), "RULER session: a between-rows dot lies between two ticks and on none", isBetweenTicks);
}

async function validateBracketAndPopup(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  const bracket = await page.evaluate<BracketFacts>(buildBracketProbe("document", BRACKET_SELECTOR));
  const useCy = await page.evaluate<number>(buildDotCentre(String(ANNOTATION_BLOCK_IDS[2])));
  const resultCy = await page.evaluate<number>(buildDotCentre(String(ANNOTATION_BLOCK_IDS[5])));
  reportCheck("RULER session: the pair bracket spans the t dot to the r dot", isBracketSpanning(bracket, useCy, resultCy, APART_PX), bracket);
  await reportFacts(page, buildHoverProbe(buildRecordDot(String(ANNOTATION_BLOCK_IDS[2]))),"RULER session: the dot popup shows the session title, the log line and the session color", isPopupRight);
}

export async function validateSessionOff(page: HeadlessPage, offLeft: number): Promise<void> {
  await toggleSessionColumn(page, false);
  const off = await page.evaluate<OffFacts>(OFF_FACTS);
  reportCheck("RULER session off: the track is gone, --track-w is 0px, and the stage is back", isSessionOff(off, offLeft), off);
  await reportFacts(page, COLOUR_FACTS, "RULER session off: every row returns to the plain color", isRowsPlain);
  await reportFacts(page, TICK_TEXT_FACTS, "RULER session off: the row text stays in the new format", isRowTextRight);
}

// Leaves the column on for the caller; returns the stage left measured with it off.
export async function validateSessionState(page: HeadlessPage): Promise<number> {
  await page.evaluate(SCROLL_HOME);
  const offLeft = await page.evaluate<number>(STAGE_LEFT);
  await toggleSessionColumn(page, true);
  await validateTrack(page, offLeft);
  await validateScan(page);
  await validateLines(page);
  await validateBetweenAndSame(page);
  await validateBracketAndPopup(page);
  await page.evaluate(SCROLL_HOME);
  await shootRulerState(page, RULER_UI_SCREENSHOTS.session);
  return offLeft;
}
