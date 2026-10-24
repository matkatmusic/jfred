// Task 355: boots the real viewer (no --fixture) and checks the Edit box against the real /api/layer1-edits payload.

import { spawn, execFileSync, execSync, type ChildProcess } from "node:child_process";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type WireEditsView } from "../../webapp/layer1-wire.ts";
import { findFreePort, openHeadlessPage, pause, waitForHttp } from "./cdp.ts";
import { executeLayer3RealChecks } from "./layer3-real-checks.ts";
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

async function fetchEditsPayload(port: number): Promise<WireEditsView> {
  const response = await fetch(`http://127.0.0.1:${port}/api/layer1-edits?${buildViewParams()}`);
  if (!response.ok) {
    throw new Error(`/api/layer1-edits answered ${response.status}: ${await response.text()}`);
  }
  return await response.json() as WireEditsView;
}

async function executeDriveAndCheck(port: number, payload: WireEditsView): Promise<void> {
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(`http://127.0.0.1:${port}/app/layer1.html?${buildViewParams()}`);
    await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0", PAGE_TIMEOUT_MS);
    await executeLayer3RealChecks(page, payload, PAGE_TIMEOUT_MS, IS_JOT ? "08-layer3-jot" : "07-layer3-real");
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
    const payload = await fetchEditsPayload(port);
    const editTotal = payload.pairs.flatMap((pair) => pair.edits).length;
    reportCheck("#355 the real endpoint returns edits to verify against", editTotal > 0, editTotal);
    await executeDriveAndCheck(port, payload);
  }
  finally {
    server.kill("SIGKILL");
    await pause(200);
    stopPort(port);
  }
  console.log(failures.length
    ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : "\nALL LAYER 3 REAL CHECKS PASSED — screenshots in scripts/visual/out/");
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
