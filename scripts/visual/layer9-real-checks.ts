// Task 361 step 6c: checks R3 to R8 and R11a on the real page against the temp repo.

import { JFRED_SHORT_HASH_LENGTH as SHORT } from "../../webapp/layer1-components/commits-column/layer1-wire-jfred.ts";
import { type HeadlessPage } from "./cdp.ts";
import * as probes from "./layer9-probes.ts";
import * as judges from "./layer9-real-judges.ts";
import * as git from "./layer9-real-repo.ts";
import { reportCheck, saveScreenshot } from "./mockup-checks.ts";

export interface RealPage { page: HeadlessPage; repo: git.RealRepo; origin: string; query: string; settingsFile: string }
interface CommitRun { drawerText: string; startedAt: Date; endedAt: Date }

const PAGE_TIMEOUT_MS = 120_000;
const SAVE_TIMEOUT_MS = 5_000;
const { REAL_INSTANTS, REAL_TEXTS, REAL_TICKS } = git;

export async function loadPage(real: RealPage): Promise<void> {
  await real.page.navigate(`${real.origin}/app/layer1.html?${real.query}`);
  await real.page.waitFor(judges.STAGE_READY, PAGE_TIMEOUT_MS);
}

export async function enableCommitMode(real: RealPage): Promise<void> {
  await real.page.evaluate(probes.COMMIT_MODE_CLICK);
  await real.page.waitFor(judges.ARMED_STATE, PAGE_TIMEOUT_MS);
}

async function triggerCommit(page: HeadlessPage): Promise<void> {
  await page.evaluate(probes.COMMIT_CLICK);
  await page.waitFor(judges.COMMIT_SETTLED, PAGE_TIMEOUT_MS);
}

async function listShownShortHashes(page: HeadlessPage): Promise<string[]> {
  return judges.listEntryShortHashes(await page.evaluate<probes.EntryFacts[]>(probes.ENTRY_FACTS));
}

// R3 and R3c: arming shows every kind; one tick sets the base, a later tick is pending.
async function validateArmAndMarks(real: RealPage): Promise<void> {
  const { page, repo } = real;
  const arm = await page.evaluate<judges.ArmFacts>(judges.ARM_FACTS);
  reportCheck("l9-real R3c arming turns on every kind and edit dots exist", judges.isEveryKindArmed(arm), arm);
  await page.evaluate(probes.buildClickTick(REAL_TICKS.baseCommit));
  await page.evaluate(probes.buildClickTick(REAL_TICKS.secondCommit));
  const shown = await listShownShortHashes(page);
  const pending = await page.evaluate<probes.PendingFacts>(probes.PENDING_FACTS);
  const drawer = await page.evaluate<probes.DrawerFacts>(probes.DRAWER_FACTS);
  reportCheck("l9-real R3 the base entry, one pending entry and the Commit button show", shown.includes(repo.baseHash.slice(0, SHORT)) && pending.entries === 1 && drawer.hasButton, { shown, pending, drawer });
  await saveScreenshot(page, judges.SCREENSHOT_NAMES.armed);
}

async function validateBaseSurvivesReload(real: RealPage): Promise<void> {
  const { repo } = real;
  const isSaved = await git.waitUntilSavedBase(real.settingsFile, repo.repoDir, repo.baseHash, SAVE_TIMEOUT_MS);
  await loadPage(real);
  await enableCommitMode(real);
  const shown = await listShownShortHashes(real.page);
  reportCheck("l9-real R3a the settings file holds the full base hash and the strip shows the base after a reload", isSaved && shown.includes(repo.baseHash.slice(0, SHORT)), shown);
}

// R3b and R11a: an unchanged range asks first and writes nothing.
async function validateUnchangedAsk(real: RealPage): Promise<void> {
  const { page, repo } = real;
  await page.evaluate(probes.buildClickTick(REAL_TICKS.secondCommit));
  const objectsBefore = git.listObjectFiles(repo.repoDir);
  await page.evaluate(judges.WATCH_LABELS);
  await triggerCommit(page);
  await page.waitFor(judges.LOADING_IDLE, PAGE_TIMEOUT_MS);
  const yesNo = await page.evaluate<judges.YesNoFacts>(judges.YESNO_FACTS);
  const isNothingWritten = git.readJfredRef(repo.repoDir) === "" && judges.isSameItems(objectsBefore, git.listObjectFiles(repo.repoDir));
  reportCheck("l9-real R3b the unchanged range asks, names the next instant and writes nothing", judges.isYesNoNaming(yesNo, REAL_INSTANTS.writeOne.toISOString().slice(0, 19)) && isNothingWritten, yesNo);
  const labels = await page.evaluate<string[]>(judges.READ_LABELS);
  reportCheck("l9-real R11a the loading bar showed two labels and is hidden after the reply", judges.isTwoDistinctLabels(labels), labels);
}

// R3b: No keeps the mark, Yes moves it; returns the final commit run.
async function validateUnchangedAnswers(real: RealPage): Promise<CommitRun> {
  const { page } = real;
  await page.evaluate(probes.YESNO_NO);
  const kept = await page.evaluate<probes.PendingFacts>(probes.PENDING_FACTS);
  const rowsAfterNo = (await page.evaluate<judges.YesNoFacts>(judges.YESNO_FACTS)).rows;
  reportCheck("l9-real R3b No keeps the pending entry and closes the row", kept.entries === 1 && rowsAfterNo === 0, kept);
  await triggerCommit(page);
  await page.evaluate(probes.YESNO_YES);
  await page.waitFor(`${judges.PENDING_TICK_TIME}.startsWith(${JSON.stringify(REAL_TICKS.writeOne)})`, PAGE_TIMEOUT_MS);
  const drawerText = (await page.evaluate<probes.DrawerFacts>(probes.DRAWER_FACTS)).text;
  const startedAt = new Date();
  await triggerCommit(page);
  return { drawerText, startedAt, endedAt: new Date() };
}

async function validateFirstCommit(real: RealPage, before: git.RepoState, run: CommitRun): Promise<void> {
  const { page, repo } = real;
  const hashes = git.listJfredHashes(repo.repoDir);
  const facts = git.readJfredCommitFacts(repo.repoDir, hashes[0]!);
  const entries = await page.evaluate<probes.EntryFacts[]>(probes.ENTRY_FACTS);
  reportCheck("l9-real R4 one jfred commit whose parent is the base and whose a.txt is the first Write", hashes.length === 1 && judges.isChainedCommit(facts, repo.baseHash, REAL_TEXTS.writeOne), facts);
  reportCheck("l9-real R4 author date is the mark instant", judges.isAuthorDateAtMark(facts.authorDate, REAL_INSTANTS.writeOne), facts.authorDate);
  reportCheck("l9-real R4 committer date lies between the click start and end", judges.isCommitterDateBetween(facts.committerDate, run.startedAt, run.endedAt), facts.committerDate);
  reportCheck("l9-real R4 commit message equals the drawer text", facts.message === run.drawerText.trim(), facts.message);
  reportCheck("l9-real R4 HEAD, status and the working tree are unchanged", judges.isSameRepoState(before, git.readRepoState(repo.repoDir)));
  reportCheck("l9-real R4 the page shows the real short hash, never a c0ffee one", judges.isRealEntryHash(entries, hashes[0]!.slice(0, SHORT)), entries);
}

// R5 and R6: the second commit chains onto the first, and its patch applies.
async function validateSecondCommit(real: RealPage): Promise<void> {
  const { page, repo } = real;
  await page.evaluate(probes.buildClickTick(REAL_TICKS.writeTwo));
  await triggerCommit(page);
  const [secondHash, firstHash] = git.listJfredHashes(repo.repoDir);
  const facts = git.readJfredCommitFacts(repo.repoDir, secondHash!);
  reportCheck("l9-real R5 the second commit has the first jfred commit as parent and the second Write text", judges.isChainedCommit(facts, firstHash, REAL_TEXTS.writeTwo), facts);
  reportCheck("l9-real R6 git apply --check of the diff passes in a clone at the parent", git.measureApplyCheckStatus(repo, firstHash!, secondHash!) === 0);
  await saveScreenshot(page, judges.SCREENSHOT_NAMES.committed);
}

// R7 and R8: a reload lists base and commits; the picker hides jfred.
async function validateReloadAndRefs(real: RealPage): Promise<void> {
  const { page, repo } = real;
  await loadPage(real);
  await enableCommitMode(real);
  const expected = judges.listShortHashes([repo.baseHash, ...git.listJfredHashes(repo.repoDir)], SHORT);
  const shown = await listShownShortHashes(page);
  reportCheck("l9-real R7 after a reload the strip lists the base and both commits", judges.isSameItems(shown, expected), { shown, expected });
  const refs = await (await fetch(`${real.origin}/api/layer1-refs?${real.query}`)).json() as { branches: string[] };
  const options = await page.evaluate<string[]>(judges.BRANCH_OPTIONS);
  reportCheck("l9-real R8 the refs route and the branch picker exclude jfred", !refs.branches.includes("jfred") && !options.includes("jfred"), { refs, options });
}

// R9 runs in layer9-real.ts after this list.
export async function validateFlaggedChecks(real: RealPage): Promise<void> {
  await loadPage(real);
  await enableCommitMode(real);
  const stateBefore = git.readRepoState(real.repo.repoDir);
  await validateArmAndMarks(real);
  await validateBaseSurvivesReload(real);
  await validateUnchangedAsk(real);
  const run = await validateUnchangedAnswers(real);
  await validateFirstCommit(real, stateBefore, run);
  await validateSecondCommit(real);
  await validateReloadAndRefs(real);
}
