// Task 358 real check: proof gate first, then one real jot script is replayed and checked.

import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertSandboxImagePresent } from "../../src/reconstruction_script_sandbox_docker.ts";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds } from "./cdp.ts";
import { executeLayer6RealChecks } from "./layer6-real-checks.ts";
import { fetchRunsView, findRealScript, type WireTarget } from "./layer6-real-pick.ts";
import { failures, reportCheck } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOT_RECOVERY_DIR = "/Users/matkatmusicllc/Programming/jot-recovery/claude-data";
const JOT_REPO = "/Users/matkatmusicllc/Programming/jot";
const PROOF_TESTS = ["tests/reconstruction_script_sandbox_proof.test.ts", "tests/reconstruction_script_sandbox_proof_box.test.ts"];
const POPUP_SEEN_FLAG = "--user-saw-blocked-popup";
const WATCHED_PORT = 7343;
const LAYER1_SETTINGS_FILE = join(homedir(), ".jfred-layer1-settings.json");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const PAGE_TIMEOUT_MS = 600_000;

function assertPopupSeen(): void {
  const isPopupSeen = process.argv.includes(POPUP_SEEN_FLAG);
  if (!isPopupSeen) {
    throw new Error(`stop: ask the user to look at the blocked popup (task 358 part M), then pass ${POPUP_SEEN_FLAG}`);
  }
}

// Throws with the test output shown when a proof test is red; then checks the image.
function executeProofGate(): void {
  execFileSync("node", ["--import", "tsx", "--test", ...PROOF_TESTS], { cwd: JFRED_ROOT, stdio: "inherit" });
  assertSandboxImagePresent();
}

// Prints who listens on 7343; nothing is killed, the viewer here uses its own free port.
function printWatchedPort(): void {
  const listeners = spawnSync("lsof", ["-nP", "-i", `:${WATCHED_PORT}`], { encoding: "utf8" });
  console.log(`lsof :${WATCHED_PORT}: ${listeners.stdout.trim() || "nothing listens"}`);
}

function readSettingsHash(): string {
  const isPresent = existsSync(LAYER1_SETTINGS_FILE);
  return isPresent ? execFileSync("shasum", [LAYER1_SETTINGS_FILE], { encoding: "utf8" }).trim() : "absent";
}

function buildTarget(port: number): WireTarget {
  const params = new URLSearchParams({ dir: JOT_REPO, repo: JOT_REPO });
  params.append("jsonl", join(JOT_RECOVERY_DIR, "projects", "-Users-matkatmusicllc-Programming-jot"));
  return { origin: `http://127.0.0.1:${port}`, query: params.toString() };
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const cacheFile = join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json");
  const memoFile = join(mkdtempSync(join(tmpdir(), "jfred-memo-")), "sandbox-memo.json");
  const server = spawn("node", [
    "--import", "tsx", "src/viewer_server.ts", "--projects-dir", join(JOT_RECOVERY_DIR, "projects"),
    "--file-history-dir", join(JOT_RECOVERY_DIR, "file-history"), "--port", String(port),
    "--settings-file", settingsFile, "--cache-file", cacheFile, "--sandbox-memo-file", memoFile,
  ], { cwd: JFRED_ROOT, stdio: ["ignore", "ignore", "inherit"] });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

async function executeRealChecks(target: WireTarget): Promise<void> {
  const picked = await findRealScript(target, await fetchRunsView(target));
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(`${target.origin}/app/layer1.html?${target.query}`);
    await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0", PAGE_TIMEOUT_MS);
    await executeLayer6RealChecks(page, target, picked, PAGE_TIMEOUT_MS);
  }
  finally {
    await page.close();
  }
}

async function executeWithViewer(): Promise<void> {
  execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.webapp.json"], { cwd: JFRED_ROOT, stdio: "inherit" });
  const port = await findFreePort();
  const server = await launchViewer(port);
  try {
    await executeRealChecks(buildTarget(port));
  }
  finally {
    server.kill("SIGKILL");
    await waitMilliseconds(200);
  }
}

function printSummary(): void {
  const passed = "\nALL LAYER 6 REAL CHECKS PASSED: screenshots in scripts/visual/out/";
  console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}` : passed);
}

async function executeMain(): Promise<void> {
  assertPopupSeen();
  executeProofGate();
  printWatchedPort();
  const hashBefore = readSettingsHash();
  console.log(`layer1 settings sha before: ${hashBefore}`);
  await executeWithViewer();
  const hashAfter = readSettingsHash();
  console.log(`layer1 settings sha after:  ${hashAfter}`);
  reportCheck("l6-real the layer1 settings file is unchanged", hashBefore === hashAfter);
  printSummary();
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
