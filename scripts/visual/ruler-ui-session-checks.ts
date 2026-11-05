// Ruler UI judges for the session column; the page steps live in ruler-ui-session-run.ts.

import { FIXTURE_LOG_SESSIONS } from "../../src/viewer_api_layer7_fixture_sessions.ts";
import { computeBarReservePx, computeTrackWidthPx } from "../../webapp/layer1-session-lanes.ts";
import { type HeadlessPage } from "./cdp.ts";
import { isNear } from "./layer7-facts.ts";
import { findSessionEndIds } from "./layer7-session-ends.ts";
import { EDGE_PX, LEVEL_PX } from "./ruler-ui-checks.ts";
import { FIXTURE_TICK_COUNT, SESSION_TOGGLE_CLICK, WAIT_MS, type Box, type HoverFacts } from "./ruler-ui-probes.ts";

export interface SessionFacts { isCurrent: boolean; background: string; trackLeft: number; trackWidth: number; rulerRight: number; stageLeft: number; laneXs: string[] }
interface ScannedTick { computed: string; expected: string | undefined }
export interface ScanFacts { letters: string[]; titled: number; alabels: number; colours: string[][]; coloured: ScannedTick[] }
export interface LineFacts { laneX: string; top: number; bottom: number; dotCy: number }
export interface MidFacts { minGap: number; isBetween: boolean }
export interface SameFacts { first: Box; second: Box; tickClasses: string; tickColor: string; plainColor: string }
export interface OffFacts { trackCount: number; trackWidth: string; stageLeft: number }

const DOT_LETTERS = ["u", "a", "t", "r", "h", "m", "n", "?"];
// const FIXTURE_TRACK_WIDTH_PX = 96;
// const MIN_COLOURED_TICKS = 12;
const FIXTURE_TRACK_WIDTH_PX = 74;
const MAX_TRACK_WIDTH_PX = 100;
// Every ruler row has one session except the one row where two sessions share an instant.
export const EXPECTED_COLOURED_TICKS = FIXTURE_TICK_COUNT - 1;
export const APART_PX = 2;
const SIDE_BY_SIDE_PX = 14;
const POPUP_LABEL = "Bash: npm test";
const FIRST_SESSION = FIXTURE_LOG_SESSIONS[0]!;
export const FIRST_SESSION_ID = String(FIRST_SESSION.id);
// export const FIRST_ID = String(ANNOTATION_BLOCK_IDS[0]);
// Every ruler row has a dot now, so the first session starts at row 0 and ends at a row dot.
export const FIRST_ID = findSessionEndIds(FIRST_SESSION.id).firstId;

const isDotLetter = (letter: string) => DOT_LETTERS.includes(letter);
const isSingleColour = (colours: string[]) => colours.length === 1;
const isTickColourRight = (tick: ScannedTick) => tick.computed === tick.expected;

export function isToggleGreen(f: SessionFacts): boolean {
  const channels: number[] = [];
  const matches = f.background.match(/\d+/g);
  for (const text of matches ?? [])
    channels.push(Number(text));
  const [red = 0, green = 0, blue = 0] = channels;
  return f.isCurrent && green > red && green > blue;
}

export function isTrackPlaced(f: SessionFacts): boolean {
  const isWidthRight = isNear(f.trackWidth, computeTrackWidthPx(f.laneXs.length, computeBarReservePx(0)), EDGE_PX);
  const isNarrow = isNear(f.trackWidth, FIXTURE_TRACK_WIDTH_PX, EDGE_PX) && f.trackWidth < MAX_TRACK_WIDTH_PX;
  return f.laneXs.length === 3 && isWidthRight && isNarrow && isNear(f.trackLeft, f.rulerRight, EDGE_PX);
}

export const isStageShifted = (offLeft: number, f: SessionFacts) => isNear(f.stageLeft - offLeft, f.trackWidth, EDGE_PX);
export function isEveryDotLetterRight(scan: ScanFacts): boolean {
  let isRight = scan.letters.length > 0 && scan.titled === 0 && scan.alabels === 0;
  for (const letter of scan.letters)
    isRight &&= isDotLetter(letter);
  return isRight;
}

export function isEverySessionColourRight(scan: ScanFacts): boolean {
  const allColours = new Set<string>();
  let isEverySingle = true;
  for (const colours of scan.colours) {
    isEverySingle &&= isSingleColour(colours);
    for (const colour of colours)
      allColours.add(colour);
  }
  let isEveryTickRight = scan.coloured.length === EXPECTED_COLOURED_TICKS;
  for (const tick of scan.coloured)
    isEveryTickRight &&= isTickColourRight(tick);
  const isFourSessions = scan.colours.length === FIXTURE_LOG_SESSIONS.length && allColours.size === FIXTURE_LOG_SESSIONS.length;
  return isFourSessions && isEverySingle && isEveryTickRight;
}

export const isBetweenTicks = (f: MidFacts) => f.minGap > APART_PX && f.isBetween;
export const isLineStartAt = (f: LineFacts) => isNear(f.top, f.dotCy, LEVEL_PX);
export const isLineEndAt = (f: LineFacts) => isNear(f.bottom, f.dotCy, LEVEL_PX);

export function isSameInstantRight(f: SameFacts): boolean {
  const isLevel = isNear((f.first.top + f.first.bottom) / 2, (f.second.top + f.second.bottom) / 2, LEVEL_PX);
  const isSideBySide = Math.abs(f.first.left - f.second.left) >= SIDE_BY_SIDE_PX && (f.first.right <= f.second.left || f.second.right <= f.first.left);
  return isLevel && isSideBySide && !f.tickClasses.split(" ").includes("s-coloured") && f.tickColor === f.plainColor;
}

export function isPopupRight(f: HoverFacts): boolean {
  const isTextRight = f.lines.length === 2 && f.lines[0] === FIRST_SESSION.title && f.lines[1] === POPUP_LABEL;
  const isPlaced = f.box !== null && f.box.left >= f.target.right - EDGE_PX && f.box.top < f.target.bottom && f.box.bottom > f.target.top;
  return f.isVisible && isTextRight && isPlaced && f.background === f.targetBackground && !f.hasTitle && f.isHiddenAfter;
}

export const isSessionOff = (f: OffFacts, firstStageLeft: number) => f.trackCount === 0 && f.trackWidth === "0px" && isNear(f.stageLeft, firstStageLeft, EDGE_PX);

export async function toggleColumn(page: HeadlessPage, clickExpression: string, elementId: string, isOn: boolean): Promise<void> {
  await page.evaluate(clickExpression);
  await page.waitFor(`(document.getElementById('${elementId}') !== null) === ${isOn}`, WAIT_MS);
}
export const toggleSessionColumn = (page: HeadlessPage, isOn: boolean) => toggleColumn(page, SESSION_TOGGLE_CLICK, "annotation-track", isOn);
