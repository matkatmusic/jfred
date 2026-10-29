// End-to-end visual verification: build, launch viewer, drive Chrome, assert geometry.  Usage: node --import tsx scripts/visual/run.ts [label]

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeLayer1Defaults } from "../../src/viewer_api_layer1_defaults.ts";
import { listStateViolations } from "./assertions.ts";
import type { Violation } from "./violation-geometry.ts";
import { formatViolationSummary, listExamples } from "./violation-report.ts";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds } from "./cdp.ts";
import { GEOMETRY_PROBE, type StateGeometry } from "./geometry.ts";
import { VISUAL_STATES } from "./states.ts";

// Kill stale viewer on this port before each run to avoid false negatives.
const CONVENTIONAL_PORT = 7343;

// Assertions measure against this viewport; changing it redefines "off screen".
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Uses debugConfig.json defaults if present, else this repo as its own fixture.
const DEBUG_DEFAULTS = computeLayer1Defaults();
const VIEW_DIR = DEBUG_DEFAULTS.dir ?? JFRED_ROOT;
const VIEW_REPO = DEBUG_DEFAULTS.repo ?? JFRED_ROOT;

// Layer 1 ignores projects dir; demo bundle avoids touching ~/.claude/projects.
const PROJECTS_DIR = join(JFRED_ROOT, "demo", "projects");

function stopPort(port: number): void {
  execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

// Build webapp so the loop verifies the current source, not a stale dist.
function buildWebapp(): void {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", PROJECTS_DIR, "--port", String(port), "--settings-file", settingsFile,
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

export function buildViewUrl(port: number): string {
  const params = new URLSearchParams({ dir: VIEW_DIR, repo: VIEW_REPO });
  return `http://127.0.0.1:${port}/app/layer1.html?${params}`;
}

// One state's two artifacts. The PNG is what the user reads; the JSON is what the assertions read.
async function saveStateCapture(
  page: Awaited<ReturnType<typeof openHeadlessPage>>,
  outDir: string,
  name: string,
): Promise<StateGeometry> {
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(await page.screenshot(), "base64"));
  const geometry = { ...await page.evaluate<StateGeometry>(GEOMETRY_PROBE), state: name };
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(geometry));
  return geometry;
}

// Drive every state in order, capturing as each one lands.
async function collectAllStates(port: number, outDir: string): Promise<StateGeometry[]> {
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(buildViewUrl(port));
    const captured: StateGeometry[] = [];
    for (const state of VISUAL_STATES) {
      process.stdout.write(`  driving ${state.name}\n`);
      await state.drive(page);
      captured.push(await saveStateCapture(page, outDir, state.name));
    }
    return captured;
  }
  finally {
    await page.close();
  }
}

async function executeVisualRun(): Promise<number> {
  const label = process.argv[2] ?? "run";
  const outDir = join(JFRED_ROOT, "scripts", "visual", "out", label);
  mkdirSync(outDir, { recursive: true });

  buildWebapp();
  stopPort(CONVENTIONAL_PORT);
  const port = await findFreePort();
  stopPort(port);
  const server = await launchViewer(port);
  try {
    const captured = await collectAllStates(port, outDir);
    const violations: Violation[] = [];
    for (const geometry of captured) {
      violations.push(...listStateViolations(geometry));
    }
    writeFileSync(join(outDir, "violations.json"), JSON.stringify(violations, null, 2));
    const bubbles = captured[0]?.fileboxes.length ?? 0;
    process.stdout.write(`\n${label}: ${captured.length} states, ${bubbles} bubbles, ${violations.length} violations\n`);
    for (const line of [...formatViolationSummary(violations), ...listExamples(violations, 3)]) {
      process.stdout.write(`${line}\n`);
    }
    process.stdout.write(`artifacts: ${outDir}\n`);
    return violations.length === 0 ? 0 : 1;
  }
  finally {
    server.kill("SIGKILL");
    await waitMilliseconds(200);
    stopPort(port);
  }
}

// Only when invoked as the script, so the test can import the pure helpers above without launching a browser.
const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  process.exitCode = await executeVisualRun();
}

