// Boots the viewer twice (fixture mode, then real data), drives every proof state and records each state's computed styles.

import { execFileSync, execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StyleCapture } from "./computed-style-diff.ts";
import { STYLE_PROBE, WAIT_FOR_STABLE_LAYOUT, type PageStyleSnapshot } from "./computed-style-page-probe.ts";
import { addSnapshotToBuilder, createCaptureBuilder, type CaptureBuilder } from "./computed-style-probe.ts";
import { executeFixtureStates, executeRealStates } from "./computed-style-states.ts";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds, type HeadlessPage } from "./cdp.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const SETTLE_MS = 400;
const ANIMATIONS_DONE_TIMEOUT_MS = 30_000;
const LAYER1_SETTINGS_FILE = join(homedir(), ".jfred-layer1-settings.json");

export interface ViewerPaths {
  projectsDir: string;
  settingsFile: string;
  cacheFile: string;
}

function stopPort(port: number): void {
  execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

function readSettingsHash(): string {
  const isPresent = existsSync(LAYER1_SETTINGS_FILE);
  return isPresent ? execFileSync("shasum", [LAYER1_SETTINGS_FILE], { encoding: "utf8" }).trim() : "absent";
}

// Same flags as mockup.ts (fixture) and run.ts (real); a throwaway settings file keeps ~/.jfred-layer1-settings.json untouched.
export function listViewerArguments(port: number, isFixture: boolean, paths: ViewerPaths): string[] {
  const viewerArguments = ["src/viewer_server.ts", "--projects-dir", paths.projectsDir, "--port", String(port)];
  viewerArguments.push("--settings-file", paths.settingsFile, "--cache-file", paths.cacheFile);
  if (isFixture) {
    viewerArguments.push("--fixture");
  }
  return viewerArguments;
}

async function launchViewer(port: number, isFixture: boolean): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const cacheFile = join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json");
  const projectsDir = join(JFRED_ROOT, isFixture ? "scripts" : "demo/projects");
  const viewerArguments = listViewerArguments(port, isFixture, { projectsDir, settingsFile, cacheFile });
  const server = spawn("node_modules/.bin/tsx", viewerArguments, { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

// Waits out CSS animations and transitions so a half-finished value is never recorded.
async function saveStyles(page: HeadlessPage, builder: CaptureBuilder, state: string): Promise<void> {
  await page.waitFor("document.getAnimations().length === 0", ANIMATIONS_DONE_TIMEOUT_MS);
  await waitMilliseconds(SETTLE_MS);
  const isLayoutStable = await page.evaluate<boolean>(WAIT_FOR_STABLE_LAYOUT);
  if (!isLayoutStable) {
    throw new Error(`state ${state}: the minimap box or the scroll position kept changing`);
  }
  const snapshot = await page.evaluate<PageStyleSnapshot>(STYLE_PROBE);
  addSnapshotToBuilder(builder, state, snapshot);
  console.log(`  ${state}: ${snapshot.elements.length} element-style entries`);
}

// Other sessions change the live tree, so the real page reads a clone frozen here.
const REAL_DATA_COMMIT = "a5eeb8b11de7077e08f1cbc25d915fab58919efc";

export function buildRealPageUrl(port: number, dataDir: string): string {
  const params = new URLSearchParams({ dir: dataDir, repo: dataDir });
  return `http://127.0.0.1:${port}/app/layer1.html?${params}`;
}

// Fixed path and file times: the ruler draws file times, so a fresh clone differs.
function createFrozenDataDir(): string {
  const dataDir = join(tmpdir(), `jfred-frozen-${REAL_DATA_COMMIT.slice(0, 8)}`, "jfred");
  const isAlreadyCloned = existsSync(dataDir);
  if (isAlreadyCloned) {
    return dataDir;
  }
  execFileSync("git", ["clone", "--quiet", "--no-checkout", JFRED_ROOT, dataDir]);
  execFileSync("git", ["-C", dataDir, "checkout", "--quiet", REAL_DATA_COMMIT]);
  execSync("git ls-files -z | xargs -0 touch -t 202001010000", { cwd: dataDir, shell: "/bin/sh" });
  return dataDir;
}

async function executeModeStates(page: HeadlessPage, builder: CaptureBuilder, port: number, isFixture: boolean): Promise<void> {
  async function saveState(state: string): Promise<void> {
    await saveStyles(page, builder, state);
  }
  if (isFixture) {
    await executeFixtureStates(page, `http://127.0.0.1:${port}/app/layer1.html`, saveState);
    return;
  }
  await executeRealStates(page, buildRealPageUrl(port, createFrozenDataDir()), saveState);
}

async function collectMode(builder: CaptureBuilder, isFixture: boolean): Promise<void> {
  const port = await findFreePort();
  stopPort(port);
  const server = await launchViewer(port, isFixture);
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await executeModeStates(page, builder, port, isFixture);
  }
  finally {
    await page.close();
    server.kill("SIGKILL");
    await waitMilliseconds(200);
    stopPort(port);
  }
}

export async function collectAllCaptures(): Promise<StyleCapture> {
  execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.webapp.json"], { cwd: JFRED_ROOT, stdio: "inherit" });
  const settingsHashBefore = readSettingsHash();
  const builder = createCaptureBuilder();
  await collectMode(builder, true);
  await collectMode(builder, false);
  const settingsHashAfter = readSettingsHash();
  console.log(`layer1 settings sha before: ${settingsHashBefore}\nlayer1 settings sha after:  ${settingsHashAfter}`);
  if (settingsHashBefore !== settingsHashAfter) {
    throw new Error("the run changed the saved layer1 settings file");
  }
  return builder.capture;
}
