// Task 361 step 6c: Layer 9 real-page check against its own temp repo.

import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds } from "./cdp.ts";
import * as probes from "./layer9-probes.ts";
import { REQUEST_COUNT } from "./layer7-probes.ts";
import { enableCommitMode, loadPage, validateFlaggedChecks, type RealPage } from "./layer9-real-checks.ts";
import * as judges from "./layer9-real-judges.ts";
import { REAL_TICKS, createRealRepo, readJfredRef, waitUntilSavedBase, type RealRepo } from "./layer9-real-repo.ts";
import { failures, reportCheck } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WATCHED_PORT = 7343;
const LAYER1_SETTINGS_FILE = join(homedir(), ".jfred-layer1-settings.json");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const PAGE_TIMEOUT_MS = 120_000;
const SAVE_TIMEOUT_MS = 5_000;

interface Viewer { server: ChildProcess; settingsFile: string }
type ExecuteChecks = (real: RealPage) => Promise<void>;

// Prints who listens on 7343; nothing is killed, the viewer here uses its own free port.
function printWatchedPort(): void {
  const listeners = spawnSync("lsof", ["-nP", "-i", `:${WATCHED_PORT}`], { encoding: "utf8" });
  console.log(`lsof :${WATCHED_PORT}: ${listeners.stdout.trim() || "nothing listens"}`);
}

function readSettingsHash(): string {
  const isPresent = existsSync(LAYER1_SETTINGS_FILE);
  return isPresent ? execFileSync("shasum", [LAYER1_SETTINGS_FILE], { encoding: "utf8" }).trim() : "absent";
}

function createTempFilePath(prefix: string, fileName: string): string {
  return join(mkdtempSync(join(tmpdir(), prefix)), fileName);
}

// Every launch gets fresh temp settings, cache and memo files: the home settings are never touched.
async function launchViewer(repo: RealRepo, port: number, isWriteAllowed: boolean): Promise<Viewer> {
  const settingsFile = createTempFilePath("jfred-settings-", "settings.json");
  writeFileSync(settingsFile, "{}");
  const args = [
    "--import", "tsx", "src/viewer_server.ts", "--projects-dir", repo.projectsDir, "--file-history-dir", repo.fileHistoryDir, "--port", String(port),
    "--settings-file", settingsFile, "--cache-file", createTempFilePath("jfred-cache-", "cache.json"), "--sandbox-memo-file", createTempFilePath("jfred-memo-", "sandbox-memo.json"),
  ];
  if (isWriteAllowed) {
    args.push("--allow-jfred-writes");
  }
  const server = spawn("node", args, { cwd: JFRED_ROOT, stdio: ["ignore", "ignore", "inherit"] });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return { server, settingsFile };
}

async function executePhase(repo: RealRepo, isWriteAllowed: boolean, executeChecks: ExecuteChecks): Promise<void> {
  const port = await findFreePort();
  const viewer = await launchViewer(repo, port, isWriteAllowed);
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await executeChecks({ page, repo, origin: `http://127.0.0.1:${port}`, query: judges.buildPageQuery(repo), settingsFile: viewer.settingsFile });
  }
  finally {
    await page.close();
    viewer.server.kill("SIGKILL");
    await waitMilliseconds(200);
  }
}

// R1 and R2: the server runs without the write flag.
async function validateUnflaggedChecks(real: RealPage): Promise<void> {
  const { page, repo } = real;
  await loadPage(real);
  const button = await page.evaluate<{ isHidden: boolean; display: string }>(probes.BUTTON_FACTS);
  const stripCount = await page.evaluate<number>(probes.STRIP_COUNT);
  const isButtonShown = !button.isHidden && button.display !== "none";
  reportCheck("l9-real R1 with no jfred branch Commit mode is visible and no strip exists until armed", isButtonShown && stripCount === 0, { button, stripCount });
  await enableCommitMode(real);
  await page.evaluate(probes.buildClickTick(REAL_TICKS.baseCommit));
  await page.evaluate(probes.buildClickTick(REAL_TICKS.writeOne));
  await page.evaluate(judges.COMMIT_BUTTON_CLICK);
  await page.waitFor(judges.TOAST_SHOWN, PAGE_TIMEOUT_MS);
  const toastText = await page.evaluate<string>(judges.READ_TOAST_TEXT);
  reportCheck("l9-real R2 without the flag a toast names it and no jfred branch exists", toastText.includes(judges.WRITE_FLAG) && readJfredRef(repo.repoDir) === "", toastText);
}

// R9: Delete asks first, and No sends no request and keeps the branch.
async function validateDeleteNo(real: RealPage): Promise<void> {
  const { page, repo } = real;
  const requestsBefore = await page.evaluate<number>(REQUEST_COUNT);
  await page.evaluate(probes.DELETE_OPEN);
  const asked = await page.evaluate<judges.YesNoFacts>(judges.YESNO_FACTS);
  await page.evaluate(probes.YESNO_NO);
  const isQuiet = await page.evaluate<number>(REQUEST_COUNT) === requestsBefore;
  const rowsAfterNo = (await page.evaluate<judges.YesNoFacts>(judges.YESNO_FACTS)).rows;
  const isKept = readJfredRef(repo.repoDir) !== "" && rowsAfterNo === 0;
  reportCheck("l9-real R9 Delete shows the Yes/No row and No sends no request and keeps the branch", asked.rows === 1 && isQuiet && isKept, asked);
}

// R9: Yes removes the branch and the saved base; the next non-commit mark is refused.
async function validateDeleteYes(real: RealPage): Promise<void> {
  const { page, repo } = real;
  await page.evaluate(probes.DELETE_OPEN);
  await page.evaluate(probes.YESNO_YES);
  await page.waitFor(`${judges.STRIP_ENTRY_COUNT} === 0`, PAGE_TIMEOUT_MS);
  const isBaseCleared = await waitUntilSavedBase(real.settingsFile, repo.repoDir, "", SAVE_TIMEOUT_MS);
  reportCheck("l9-real R9 Yes empties the strip, removes the branch and clears the saved base", isBaseCleared && readJfredRef(repo.repoDir) === "");
  const refusal = await page.evaluate<probes.RefusalFacts>(probes.buildRefusalClick(REAL_TICKS.writeOne));
  reportCheck("l9-real R9 the next mark on a non-commit tick shows the baseNeedsCommit toast", refusal.isShown && refusal.text.includes(judges.BASE_NEEDS_COMMIT_TEXT), refusal);
}

async function validateFlaggedPhase(real: RealPage): Promise<void> {
  await validateFlaggedChecks(real);
  await validateDeleteNo(real);
  await validateDeleteYes(real);
}

function reportFinalChecks(hashBefore: string, runStartedMs: number): void {
  const hashAfter = readSettingsHash();
  console.log(`layer1 settings sha after:  ${hashAfter}`);
  reportCheck("l9-real R11 the real layer1 settings file is unchanged", hashBefore === hashAfter);
  const isArmedShot = judges.isScreenshotLargeEnough(judges.SCREENSHOT_NAMES.armed, runStartedMs);
  const isCommittedShot = judges.isScreenshotLargeEnough(judges.SCREENSHOT_NAMES.committed, runStartedMs);
  reportCheck("l9-real R12 both screenshots exist and are above 10 KB: the coordinator opens them", isArmedShot && isCommittedShot);
}

async function executeMain(): Promise<void> {
  const runStartedMs = Date.now();
  execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.webapp.json"], { cwd: JFRED_ROOT, stdio: "inherit" });
  printWatchedPort();
  const hashBefore = readSettingsHash();
  console.log(`layer1 settings sha before: ${hashBefore}`);
  const repo = createRealRepo();
  console.log(`temp repo: ${repo.repoDir}`);
  await executePhase(repo, false, validateUnflaggedChecks);
  await executePhase(repo, true, validateFlaggedPhase);
  reportFinalChecks(hashBefore, runStartedMs);
  const passed = "\nALL LAYER 9 REAL CHECKS PASSED: screenshots in scripts/visual/out/";
  console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}` : passed);
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
