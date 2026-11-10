// Headless engineV3 mockup check on the fixture-mode viewer.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, waitForHttp } from "./cdp.ts";
import { validateEngineV3Mockup } from "./engine-v3-checks.ts";
import { failures, saveScreenshot } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// --projects-dir stays mandatory but the fixture routes ignore it; any existing folder does.
const PROJECTS_DIR = join(JFRED_ROOT, "scripts");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

async function launchViewer(port: number): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", PROJECTS_DIR, "--port", String(port), "--fixture", "--settings-file", settingsFile, "--cache-file", join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json"),
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

async function executePageChecks(port: number): Promise<void> {
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    await page.navigate(`http://127.0.0.1:${port}/app/layer1.html`);
    await page.waitFor("document.querySelectorAll('.filebox').length > 0", 30_000);
    await validateEngineV3Mockup(page);
    await saveScreenshot(page, "engine-v3");
  }
  finally {
    await page.close();
  }
}

async function executeMain(): Promise<void> {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
  const port = await findFreePort();
  const server = await launchViewer(port);
  try {
    await executePageChecks(port);
  }
  finally {
    server.kill("SIGKILL");
  }
  console.log(failures.length
    ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : "\nALL ENGINE V3 MOCKUP CHECKS PASSED: screenshot in scripts/visual/out/mockup-engine-v3.png");
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
