// Task l4-wire-real: boots the real viewer (no --fixture) and checks the script-run box against the real /api/layer1-script-runs payload.

import { spawn, execFileSync, execSync, type ChildProcess } from "node:child_process";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type WireScriptRunsView } from "../../webapp/layer1-wire.ts";
import { findFreePort, openHeadlessPage, pause, waitForHttp } from "./cdp.ts";
import { executeLayer4RealChecks } from "./layer4-real-checks.ts";
import { reportCheck, failures } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEMO_DIR = join(JFRED_ROOT, "demo");
const DEMO_JSONL_DIR = join(DEMO_DIR, "projects", "s87-demo-composite");
const RECORDED_PREFIX = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.7y52smqe";
const DEMO_REF = "feature";

const JOT_RECOVERY_DIR = "/Users/matkatmusicllc/Programming/jot-recovery/claude-data";
const JOT_REPO = "/Users/matkatmusicllc/Programming/jot";

const IS_JOT = process.argv.includes("--jot");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const PAGE_TIMEOUT_MS = IS_JOT ? 600_000 : 40_000;

function stopPort(port: number): void {
  execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

function createDemoWorktree(): void {
  rmSync(RECORDED_PREFIX, { recursive: true, force: true });
  mkdirSync(RECORDED_PREFIX, { recursive: true });
  execFileSync("tar", ["xf", join(DEMO_DIR, "repo.git.tar"), "-C", RECORDED_PREFIX]);
  execFileSync("git", ["-C", RECORDED_PREFIX, "checkout", "-f", DEMO_REF, "--", "."]);
}

function buildViewParams(): URLSearchParams {
  const params = IS_JOT
    ? new URLSearchParams({ dir: JOT_REPO, repo: JOT_REPO })
    : new URLSearchParams({ dir: RECORDED_PREFIX, repo: RECORDED_PREFIX, ref: DEMO_REF });
  params.append("jsonl", IS_JOT ? join(JOT_RECOVERY_DIR, "projects", "-Users-matkatmusicllc-Programming-jot") : DEMO_JSONL_DIR);
  return params;
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const dataDir = IS_JOT ? JOT_RECOVERY_DIR : DEMO_DIR;
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", join(dataDir, "projects"),
    "--file-history-dir", join(dataDir, "file-history"), "--port", String(port), "--settings-file", settingsFile,
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

async function fetchScriptRunsPayload(port: number): Promise<WireScriptRunsView> {
  const response = await fetch(`http://127.0.0.1:${port}/api/layer1-script-runs?${buildViewParams()}`);
  if (!response.ok) {
    throw new Error(`/api/layer1-script-runs answered ${response.status}: ${await response.text()}`);
  }
  return await response.json() as WireScriptRunsView;
}

async function executeDriveAndCheck(port: number, payload: WireScriptRunsView): Promise<void> {
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(`http://127.0.0.1:${port}/app/layer1.html?${buildViewParams()}`);
    await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0", PAGE_TIMEOUT_MS);
    await executeLayer4RealChecks(page, payload, PAGE_TIMEOUT_MS, IS_JOT ? "09-layer4-jot" : "09-layer4-real", IS_JOT);
  }
  finally {
    await page.close();
  }
}

async function executeMain(): Promise<void> {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
  if (!IS_JOT) {
    createDemoWorktree();
  }
  const port = await findFreePort();
  stopPort(port);
  const server = await launchViewer(port);
  try {
    const startedAt = Date.now();
    const payload = await fetchScriptRunsPayload(port);
    const runTotal = payload.pairs.flatMap((pair) => pair.scriptRuns).length;
    reportCheck("l4-wire-real the real endpoint answers in under 5 s", Date.now() - startedAt < 5_000, Date.now() - startedAt);
    console.log(`payload: ${payload.pairs.length} pairs, ${runTotal} runs`);
    await executeDriveAndCheck(port, payload);
  }
  finally {
    server.kill("SIGKILL");
    await pause(200);
    stopPort(port);
  }
  console.log(failures.length
    ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : "\nALL LAYER 4 REAL CHECKS PASSED — screenshots in scripts/visual/out/");
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
