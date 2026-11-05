// Ruler review checks: heads, dots, column surfaces, minimap edge, brackets and drawers.

import { listFillerIds } from "../../src/viewer_api_layer7_fixture_data.ts";
import { FIXTURE_LOG_SESSIONS } from "../../src/viewer_api_layer7_fixture_sessions.ts";
import { type HeadlessPage } from "./cdp.ts";
import { isNear } from "./layer7-facts.ts";
import { SCROLL_HOME, buildHideSettled, buildSetHideIgnored } from "./layer7-probes.ts";
import { COMMIT_MODE_CLICK } from "./layer9-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import { reportFacts } from "./ruler-ui-checks.ts";
import {
  BRACKET_INSET_FACTS, CLOSE_DRAWER, DOT_FONT_SIZE, DRAWER_JSON_FILLED, HEAD_AFTER_ROW_CLICK, HEAD_AT_REST, HEAD_SCROLLED, LANE_GAPS, ROW_DOT_FACTS,
  SNAPSHOT_CLICK, SNAPSHOT_DRAWER_FACTS, SNAPSHOT_JSON_FILLED, SNAPSHOT_TOGGLE_CLICK, SNAPSHOT_TOGGLE_READY,
  buildDotClick, buildDotDrawerFacts, buildMinimapEdgeProbe, buildSurfaceProbe,
} from "./ruler-ui-review-probes.ts";
import { ESCAPE_CLOSE, WAIT_MS, buildScrollToDot } from "./ruler-ui-probes.ts";
import { FIRST_ID, toggleColumn, toggleSessionColumn } from "./ruler-ui-session-checks.ts";

export interface HeadTopFacts { headTop: number; paneTop: number }
export interface RowDotFacts { rowCount: number; unmatchedCount: number }
export interface SurfaceFacts { borderRightWidth: string; borderRightStyle: string; background: string; filenavBackground: string }
export interface MinimapEdgeFacts { minimapLeft: number; neighbourRight: number }
export interface BracketInsetFacts { count: number; minInset: number }
export interface DotDrawerFacts { title: string; label: string; json: string }
export interface SnapshotDrawerFacts { buttonTexts: string[]; isJsonShown: boolean; json: string }

const ONE_PX = 1;
const DOT_FONT_SIZE_TEXT = "11px";
const MIN_LANE_GAP_PX = 2;
const MAX_LANE_GAP_PX = 4;
const MIN_BRACKET_INSET_PX = 2;
const JSON_BUTTON_TEXT = "{ }";
const FILL_8 = String(listFillerIds()[8]);

export const isHeadAtPaneTop = (f: HeadTopFacts) => isNear(f.headTop, f.paneTop, ONE_PX);
export const isDotFontRight = (fontSize: string) => fontSize === DOT_FONT_SIZE_TEXT;
export const isEveryRowDotted = (f: RowDotFacts) => f.rowCount > 0 && f.unmatchedCount === 0;
export const isTrackSurfaceRight = (f: SurfaceFacts) => f.borderRightWidth === "1px" && f.borderRightStyle === "solid" && f.background === f.filenavBackground;
export const isStripSurfaceRight = (f: SurfaceFacts) => f.background === f.filenavBackground;
export const isMinimapFlush = (f: MinimapEdgeFacts) => isNear(f.minimapLeft, f.neighbourRight, ONE_PX);
export const isBracketInset = (f: BracketInsetFacts) => f.count > 0 && f.minInset >= MIN_BRACKET_INSET_PX;
export const isDotDrawerRight = (f: DotDrawerFacts) => f.title === FIXTURE_LOG_SESSIONS[0]!.title && f.label !== "" && f.json.includes(f.label);
export const isSnapshotJsonRight = (f: SnapshotDrawerFacts) => f.buttonTexts.length === 1 && f.buttonTexts[0] === JSON_BUTTON_TEXT && f.isJsonShown && f.json !== "";

export function isLaneGapRight(gaps: number[]): boolean {
  let isRight = gaps.length > 0;
  for (const gap of gaps) {
    const isInRange = gap >= MIN_LANE_GAP_PX && gap <= MAX_LANE_GAP_PX;
    isRight &&= isInRange;
  }
  return isRight;
}

async function validateHeadTops(page: HeadlessPage): Promise<void> {
  await reportFacts(page, HEAD_AT_REST, "RULER review: the session head top equals the pane top at rest", isHeadAtPaneTop);
  await reportFacts(page, HEAD_SCROLLED, "RULER review: the session head top equals the pane top when scrolled 600px", isHeadAtPaneTop);
  await reportFacts(page, HEAD_AFTER_ROW_CLICK, "RULER review: the session head top equals the pane top after a click on the first row", isHeadAtPaneTop);
  await page.evaluate(ESCAPE_CLOSE);
}

async function validateDotDrawer(page: HeadlessPage): Promise<void> {
  await page.evaluate(buildDotClick(FIRST_ID));
  await page.waitFor(DRAWER_JSON_FILLED, WAIT_MS);
  await reportFacts(page, buildDotDrawerFacts(FIRST_ID), "RULER review: a click on a dot opens the drawer with the session title and the dot label in the JSON", isDotDrawerRight);
  await page.evaluate(CLOSE_DRAWER);
}

// Ignored dots are display none while the box is ticked, so their rows would have no dot to measure.
async function setHideIgnored(page: HeadlessPage, isOn: boolean): Promise<void> {
  await page.evaluate(buildSetHideIgnored(isOn));
  await page.waitFor(buildHideSettled(isOn), WAIT_MS);
}

async function validateSessionLook(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  const fontSize = await page.evaluate<string>(DOT_FONT_SIZE);
  reportCheck("RULER review: the dot letter font is 11px", isDotFontRight(fontSize), fontSize);
  await setHideIgnored(page, false);
  await reportFacts(page, ROW_DOT_FACTS, "RULER review: every ruler row in view has a dot at its own axis height", isEveryRowDotted);
  await setHideIgnored(page, true);
  await reportFacts(page, buildSurfaceProbe("#annotation-track"), "RULER review: the track has a 1px solid right border and the File Nav background", isTrackSurfaceRight);
  await reportFacts(page, buildMinimapEdgeProbe("#annotation-track"), "RULER review: the minimap left edge is at the track right edge", isMinimapFlush);
  await reportFacts(page, BRACKET_INSET_FACTS, "RULER review: a bracket sits at least 2px right of the track left edge", isBracketInset);
  await validateDotDrawer(page);
  await page.evaluate(buildScrollToDot(FILL_8));
  await reportFacts(page, LANE_GAPS, "RULER review: dots in neighbouring lanes have a gap of 2px to 4px between their edges", isLaneGapRight);
}

async function validateCommitLook(page: HeadlessPage): Promise<void> {
  await toggleColumn(page, COMMIT_MODE_CLICK, "jfred-strip", true);
  await reportFacts(page, buildSurfaceProbe("#jfred-strip"), "RULER review: the commit strip has the File Nav background", isStripSurfaceRight);
  await reportFacts(page, buildMinimapEdgeProbe("#jfred-strip"), "RULER review: the minimap left edge is at the strip right edge", isMinimapFlush);
  await toggleColumn(page, COMMIT_MODE_CLICK, "jfred-strip", false);
}

// A node click shifts the stage, so the caller reloads the page afterwards.
export async function validateSnapshotJson(page: HeadlessPage): Promise<void> {
  await page.evaluate(SNAPSHOT_CLICK);
  await page.waitFor(SNAPSHOT_TOGGLE_READY, WAIT_MS);
  await page.evaluate(SNAPSHOT_TOGGLE_CLICK);
  await page.waitFor(SNAPSHOT_JSON_FILLED, WAIT_MS);
  await reportFacts(page, SNAPSHOT_DRAWER_FACTS, "RULER review: on a snapshot node the button reads { } and one click shows the JSON", isSnapshotJsonRight);
  await page.evaluate(CLOSE_DRAWER);
}

// Runs with both columns off and leaves them off.
export async function validateRulerReview(page: HeadlessPage): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await validateHeadTops(page);
  await reportFacts(page, buildMinimapEdgeProbe("#ruler"), "RULER review: with both columns off the minimap left edge is at the ruler right edge", isMinimapFlush);
  await toggleSessionColumn(page, true);
  await validateSessionLook(page);
  await toggleSessionColumn(page, false);
  await validateCommitLook(page);
}
