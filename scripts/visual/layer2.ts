// Task 318: boots the real viewer against the demo bundle and runs the Layer 2 checks.

import { spawn, execFileSync, execSync, type ChildProcess } from "node:child_process";
import { rmSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, pause, waitForHttp, type HeadlessPage } from "./cdp.ts";
import { executeLayer2Checks } from "./layer2-checks.ts";
import { countExpectedSnapshots, type ViewPayload } from "./layer2-payload.ts";
import { reportCheck, failures } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEMO_DIR = join(JFRED_ROOT, "demo");
const JSONL_DIR = join(DEMO_DIR, "projects", "s87-demo-composite");

// The recorded path prefix of the demo files; the working tree must be built here.
const RECORDED_PREFIX = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.7y52smqe";
const VIEW_REF = "feature";

const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

function stopPort(port: number): void {
  execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

function buildWebapp(): void {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

// Rebuild the demo working tree at the recorded prefix from repo.git.tar; a stale tree is discarded first.
function createDemoWorktree(): void {
  rmSync(RECORDED_PREFIX, { recursive: true, force: true });
  mkdirSync(RECORDED_PREFIX, { recursive: true });
  execFileSync("tar", ["xf", join(DEMO_DIR, "repo.git.tar"), "-C", RECORDED_PREFIX]);
  execFileSync("git", ["-C", RECORDED_PREFIX, "checkout", "-f", VIEW_REF, "--", "."]);
}

function buildViewUrl(port: number): string {
  const params = new URLSearchParams({ dir: RECORDED_PREFIX, repo: RECORDED_PREFIX, ref: VIEW_REF });
  params.append("jsonl", JSONL_DIR);
  return `http://127.0.0.1:${port}/app/layer1.html?${params}`;
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", join(DEMO_DIR, "projects"), "--port", String(port), "--settings-file", settingsFile,
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

// The payload the page itself renders; the driver reads it to derive every expected count.
async function fetchViewPayload(port: number): Promise<ViewPayload> {
  const params = new URLSearchParams({ dir: RECORDED_PREFIX, repo: RECORDED_PREFIX, ref: VIEW_REF });
  params.append("jsonl", JSONL_DIR);
  const response = await fetch(`http://127.0.0.1:${port}/api/layer1-view?${params}`);
  return await response.json() as ViewPayload;
}

async function executeDriveAndCheck(port: number, payload: ViewPayload): Promise<void> {
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(buildViewUrl(port));
    await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0", 40_000);
    await executeLayer2Checks(page as HeadlessPage, payload);
  }
  finally {
    await page.close();
  }
}

async function executeMain(): Promise<void> {
  buildWebapp();
  createDemoWorktree();
  const port = await findFreePort();
  stopPort(port);
  const server = await launchViewer(port);
  try {
    const payload = await fetchViewPayload(port);
    const snapTotal = countExpectedSnapshots(payload);
    reportCheck("#318 the demo fixture ships file-history snapshots to verify against", snapTotal > 0, snapTotal);
    await executeDriveAndCheck(port, payload);
  }
  finally {
    server.kill("SIGKILL");
    await pause(200);
    stopPort(port);
  }
  console.log(failures.length
    ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : "\nALL LAYER 2 CHECKS PASSED — screenshots in scripts/visual/out/");
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
