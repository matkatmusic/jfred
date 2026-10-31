// Task 357: boots the real viewer (no --fixture) and checks the branch lanes against the real /api/layer1-branches payload.

import { spawn, execFileSync, execSync, type ChildProcess } from "node:child_process";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type WireBranchesView } from "../../webapp/layer1-wire-branches.ts";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds } from "./cdp.ts";
import { executeLayer5RealChecks } from "./layer5-real-checks.ts";
import { reportCheck, failures } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REVENG_ROOT = resolve(JFRED_ROOT, "..");
const DEMO_DIR = join(JFRED_ROOT, "demo");
const DEMO_JSONL_DIR = join(DEMO_DIR, "projects", "s87-demo-composite");
const RECORDED_PREFIX = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.7y52smqe";
const DEMO_REF = "feature";

const JOT_RECOVERY_DIR = "/Users/matkatmusicllc/Programming/jot-recovery/claude-data";
const JOT_REPO = "/Users/matkatmusicllc/Programming/jot";

const IS_JOT = process.argv.includes("--jot");
const IS_REVENG = process.argv.includes("--reveng");
const IS_REAL = IS_JOT || IS_REVENG;
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const PAGE_TIMEOUT_MS = IS_REAL ? 600_000 : 40_000;
const SCREENSHOT_NAME = IS_JOT ? "11-layer5-jot" : IS_REVENG ? "11-layer5-reveng" : "11-layer5-real";

function createDemoWorktree(): void {
  rmSync(RECORDED_PREFIX, { recursive: true, force: true });
  mkdirSync(RECORDED_PREFIX, { recursive: true });
  execFileSync("tar", ["xf", join(DEMO_DIR, "repo.git.tar"), "-C", RECORDED_PREFIX]);
  execFileSync("git", ["-C", RECORDED_PREFIX, "checkout", "-f", DEMO_REF, "--", "."]);
}

function buildViewParams(): URLSearchParams {
  if (IS_REAL) {
    const repo = IS_JOT ? JOT_REPO : REVENG_ROOT;
    const folderName = repo.replaceAll("/", "-").replaceAll(" ", "-");
    return new URLSearchParams({ dir: repo, repo, jsonl: join(JOT_RECOVERY_DIR, "projects", folderName) });
  }
  return new URLSearchParams({ dir: RECORDED_PREFIX, repo: RECORDED_PREFIX, ref: DEMO_REF, jsonl: DEMO_JSONL_DIR });
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const dataDir = IS_REAL ? JOT_RECOVERY_DIR : DEMO_DIR;
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", join(dataDir, "projects"),
    "--file-history-dir", join(dataDir, "file-history"), "--port", String(port), "--settings-file", settingsFile, "--cache-file", join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json"),
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

async function fetchBranchesPayload(port: number): Promise<WireBranchesView> {
  const response = await fetch(`http://127.0.0.1:${port}/api/layer1-branches?${buildViewParams()}`);
  if (!response.ok) {
    throw new Error(`/api/layer1-branches answered ${response.status}: ${await response.text()}`);
  }
  return await response.json() as WireBranchesView;
}

async function executeDriveAndCheck(port: number, payload: WireBranchesView): Promise<void> {
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(`http://127.0.0.1:${port}/app/layer1.html?${buildViewParams()}`);
    await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0 && document.getElementById('loadbar').hidden", PAGE_TIMEOUT_MS);
    await executeLayer5RealChecks(page, payload, PAGE_TIMEOUT_MS, SCREENSHOT_NAME, IS_JOT, IS_REVENG);
  }
  finally {
    await page.close();
  }
}

async function executeMain(): Promise<void> {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
  if (!IS_REAL) {
    createDemoWorktree();
  }
  const port = await findFreePort();
  const server = await launchViewer(port);
  try {
    const startedAt = Date.now();
    const payload = await fetchBranchesPayload(port);
    let laneTotal = 0;
    for (const pair of payload.pairs) {
      laneTotal += pair.branches.length;
    }
    reportCheck("l5-real the real endpoint answers with at least one pair", payload.pairs.length > 0, Date.now() - startedAt);
    console.log(`payload: ${payload.pairs.length} pairs, ${laneTotal} lanes`);
    await executeDriveAndCheck(port, payload);
  }
  finally {
    server.kill("SIGKILL");
    await waitMilliseconds(200);
  }
  console.log(failures.length
    ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : "\nALL LAYER 5 REAL CHECKS PASSED — screenshots in scripts/visual/out/");
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
