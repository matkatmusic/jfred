// Ruler UI checks for mockups 4 and 5 (Commit mode), the hide-ignored box, and validateRulerUi. Judges live in ruler-ui-commit-judges.ts.

import { type HeadlessPage } from "./cdp.ts";
import { STRIP_IDLE } from "./layer4-probes.ts";
import { SCROLL_HOME, buildHideSettled, buildSetHideIgnored } from "./layer7-probes.ts";
import {
  COMMIT_MODE_CLICK, DELETE_CLICK, DRAWER_FACTS, TOGGLE_SETTLED, buildClickById, buildClickEntry, buildTimeToggle,
} from "./layer9-probes.ts";
import { reportCheck } from "./mockup-checks.ts";
import {
  COMMIT_HASHES, isBothRight, isCommitOff, isCommitPopupRight, isDrawerRight, isEntryColumnRight, isEveryLineRight, isEveryMarkRight,
  isIgnoredToggleRight, isNoPopup, isStripHeadRight, isStripPlaced, type BothFacts, type IgnoredDot, type IgnoredState, type StripFacts,
} from "./ruler-ui-commit-judges.ts";
import { isRowsPlain, reportFacts, shootRulerState, validateDefaultState, validateExpandedState } from "./ruler-ui-checks.ts";
import {
  BOTH_FACTS, COLOUR_FACTS, CUT_FACTS, ERROR_HOOK, IGNORED_DOT_FACTS, RULER_UI_SCREENSHOTS, STRIP_FACTS, WAIT_MS, buildHoverProbe, buildLineProbe,
} from "./ruler-ui-probes.ts";
import { validateRulerReview, validateSnapshotJson } from "./ruler-ui-review-checks.ts";
import { FIRST_ID, FIRST_SESSION_ID, type LineFacts, toggleColumn, toggleSessionColumn } from "./ruler-ui-session-checks.ts";
import { validateSessionOff, validateSessionState } from "./ruler-ui-session-run.ts";

// export * from "./ruler-ui-commit-judges.ts";

async function readIgnoredState(page: HeadlessPage, isOn: boolean): Promise<IgnoredState> {
  await page.evaluate(buildSetHideIgnored(isOn));
  await page.waitFor(buildHideSettled(isOn), WAIT_MS);
  return { dots: await page.evaluate<IgnoredDot[]>(IGNORED_DOT_FACTS), line: await page.evaluate<LineFacts>(buildLineProbe(FIRST_SESSION_ID, FIRST_ID)) };
}

// Runs with the session column on; the box ends ticked again.
async function validateIgnored(page: HeadlessPage): Promise<void> {
  const hidden = await readIgnoredState(page, true);
  const shown = await readIgnoredState(page, false);
  reportCheck("RULER session: ticked, the 2 ignored dots are display none and the line spans; unticked, they show at opacity .38", isIgnoredToggleRight(hidden, shown), [hidden, shown]);
  await readIgnoredState(page, true);
}

const toggleCommitMode = (page: HeadlessPage, isOn: boolean) => toggleColumn(page, COMMIT_MODE_CLICK, "jfred-strip", isOn);

async function validateStrip(page: HeadlessPage, offStageLeft: number): Promise<void> {
  await reportFacts(page, COLOUR_FACTS, "RULER commits: with the session button off every row stays plain", isRowsPlain);
  const strip = await page.evaluate<StripFacts>(STRIP_FACTS);
  reportCheck("RULER commits: the strip touches the ruler, is 104px wide, covers bubbles, pushes the stage nowhere, and its head holds commits and Delete", isStripPlaced(strip, offStageLeft) && isStripHeadRight(strip), strip);
  reportCheck("RULER commits: base and 2 commits share one line, each level with its tick, joined by 2 chains", isEntryColumnRight(strip), strip.entries);
  reportCheck("RULER commits: 3 dashed lines run from the ruler edge to their nodes", isEveryLineRight(strip), strip.lines);
  reportCheck("RULER commits: ticks show cut-base, cut-set, cut-ok and cut-no, and each cut-no has a title", isEveryMarkRight(strip), [strip.marks, strip.untitledNo]);
  await shootRulerState(page, RULER_UI_SCREENSHOTS.commits);
}

async function validatePopups(page: HeadlessPage): Promise<void> {
  const node = `document.querySelector('#jfred-strip .jnode[data-short-hash="${COMMIT_HASHES[1]}"]')`;
  const label = `[...document.querySelectorAll('#jfred-strip .jlabel')].find(l => l.textContent.includes('${COMMIT_HASHES[1]}'))`;
  await reportFacts(page, buildHoverProbe(node), "RULER commits: hovering the commit node shows its message in lines of 50 characters or fewer", isCommitPopupRight);
  await reportFacts(page, buildHoverProbe(label), "RULER commits: hovering the hash label shows the same message", isCommitPopupRight);
  await reportFacts(page, buildHoverProbe(`document.querySelector('#jfred-strip .jnode[data-entry-kind="base"]')`), "RULER commits: the base entry shows no popup", isNoPopup);
  await page.evaluate(buildClickEntry(COMMIT_HASHES[1]!));
  await reportFacts(page, DRAWER_FACTS, "RULER commits: a click on an entry opens the Details drawer with the message", isDrawerRight);
  await page.evaluate(buildClickById("dclose"));
}

async function validateBoth(page: HeadlessPage, offStageLeft: number): Promise<void> {
  await toggleSessionColumn(page, true);
  const both = await page.evaluate<BothFacts>(BOTH_FACTS);
  reportCheck("RULER both: the strip sits at the track edge, the stage moves by the track only, dots draw above the dashed lines", isBothRight(both, offStageLeft), both);
  await shootRulerState(page, RULER_UI_SCREENSHOTS.both);
  await toggleSessionColumn(page, false);
}

async function validateCommitState(page: HeadlessPage, offStageLeft: number): Promise<void> {
  await page.evaluate(SCROLL_HOME);
  await reportFacts(page, CUT_FACTS, "RULER commits: Commit mode off, no strip and no cut mark on any row", isCommitOff);
  await toggleCommitMode(page, true);
  await validateStrip(page, offStageLeft);
  await validatePopups(page);
  await validateBoth(page, offStageLeft);
  await page.evaluate(DELETE_CLICK);
  // The default time mode is committer, so one flip to author redraws the stage.
  await page.evaluate(buildTimeToggle("author"));
  await page.waitFor(`${TOGGLE_SETTLED} && ${STRIP_IDLE}`, WAIT_MS);
  await reportFacts(page, STRIP_FACTS, "RULER commits: after Delete and a stage redraw the strip keeps its head and Delete button", isStripHeadRight);
  await toggleCommitMode(page, false);
}

// Ends on a fresh page: Delete cannot be undone and the error hook is gone.
export async function validateRulerUi(page: HeadlessPage): Promise<void> {
  await page.evaluate(ERROR_HOOK);
  await validateDefaultState(page);
  await validateExpandedState(page);
  const offStageLeft = await validateSessionState(page);
  await validateIgnored(page);
  await validateSessionOff(page, offStageLeft);
  await validateRulerReview(page);
  await validateCommitState(page, offStageLeft);
  await validateSnapshotJson(page);
  await page.navigate(await page.evaluate<string>("location.href"));
  await page.waitFor(`document.querySelectorAll('.filebox').length > 0 && ${STRIP_IDLE}`, 30_000);
}
