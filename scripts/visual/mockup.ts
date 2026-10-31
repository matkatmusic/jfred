// Headless Layer 1 and Layer 2 acceptance checks (tasks #299-#307) on the real page.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMITS, DISK, SESSIONS } from "../../src/viewer_api_layer1_fixture_data.ts";
import { SNAPSHOTS } from "../../src/viewer_api_layer2_fixture_data.ts";
import { findFreePort, openHeadlessPage, waitForHttp, type HeadlessPage } from "./cdp.ts";
import {
  // RENDER_SIGNATURE (task 352) and buildShapeProbe (task 386): only retired checks used them.
  reportCheck, validateChrome, validateNavRows, validateOrdering,
  validateScale, failures, saveScreenshot,
} from "./mockup-checks.ts";
import { validateDrawer } from "./mockup-checks-snapshot-drawer.ts";
import { validateRulerRow, validateSnapshotNodes, validateSnapshotToggle } from "./mockup-checks-snapshots.ts";
import { executeLayer3Checks } from "./layer3-checks.ts";
import { validateLayer4 } from "./layer4-checks.ts";
import { validateKindJump } from "./kind-jump-checks.ts";
import { validateKindDashes } from "./kind-dash-checks.ts";
import { validateLayer5 } from "./layer5-checks.ts";
// // validateBubbleFlash (task 386: the real page has no bubble-click flash)
import { validateBubbleFlash, validateSessionSearch } from "./mockup-checks-nav.ts";
import { validateMultiFileDrawer } from "./mockup-checks-multi-drawer.ts";
import { validateDiffPair, validateDiffTools, validatePairArrows } from "./mockup-checks-diff.ts";
import {
  validateCrossBubbleRefusal, validateNavBugs, validateNavOpensDiskNode, validateShowOnlySelected,
} from "./mockup-checks-diff-nav.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// --projects-dir stays mandatory but the fixture routes ignore it; any existing folder does.
const PROJECTS_DIR = join(JFRED_ROOT, "scripts");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

// Task 352 retired the layer switcher; its button helpers and checks are commented out.
// const LAYER_BUTTON = (n: number) => `document.querySelector('[data-layer="${n}"]')`;
// const CURRENT_ONLY_ON_2 =
//     `${LAYER_BUTTON(2)}.classList.contains('current') && !${LAYER_BUTTON(1)}.classList.contains('current')`;

async function openLayer2(page: HeadlessPage): Promise<void> {
  // await page.evaluate(`${LAYER_BUTTON(2)}.click()`);
  await page.waitFor(`document.querySelectorAll('.n-snap').length > 0`, 10_000);
  // reportCheck("#304 the h1 reads the selected layer",
  //     await page.evaluate<string>(`document.getElementById('layer-h1').textContent`) === "Layer 2 View");
  // reportCheck("#304 [2] carries .current and [1] does not", await page.evaluate<boolean>(CURRENT_ONLY_ON_2));
}

async function executeChecks(page: HeadlessPage, pageUrl: string): Promise<void> {
  // Task 343: first, ahead of the old checks that crash on window.__fixture; it ends on a fresh page.
  await executeLayer3Checks(page, pageUrl);
  await validateLayer4(page, pageUrl);
  await validateKindJump(page, pageUrl);
  await validateKindDashes(page, pageUrl);
  await validateLayer5(page, pageUrl);
  // The page no longer sets window.__fixture; the checks read the arrays the server serves.
  await page.evaluate(`(window.__fixture = ${JSON.stringify({ SESSIONS, DISK, COMMITS, SNAPSHOTS })}, true)`);
  await page.waitFor(`document.querySelectorAll('.session-item').length > 0`, 10_000);
  await validateChrome(page);
  await validateNavRows(page);
  // const layer1 = await page.evaluate<string>(RENDER_SIGNATURE);
  // Task 386: both probes fed checks that compare the page to itself.
  // const indexAnchor = await page.evaluate<string>(
  //   `document.querySelector('[data-path="src/index.ts"]').dataset.instant`);
  // const readmeAtLayer1 = await page.evaluate<string>(buildShapeProbe("README.md"));
  // reportCheck("#304 Layer 1 draws no snapshot node",
  //     await page.evaluate<number>(`document.querySelectorAll('.n-snap').length`) === 0);
  await saveScreenshot(page, "01-layer1");

  await openLayer2(page);
  await validateScale(page);
  await validateOrdering(page);
  await validateSnapshotNodes(page);
  // Task 386: the layer switcher is gone, so this compared the page to itself.
  // Its axis OFFSET may move (#251), but its own anchor and node rows must not.
  // reportCheck("#304 a file with NO snapshots renders exactly as at Layer 1",
  //   await page.evaluate<string>(buildShapeProbe("README.md")) === readmeAtLayer1, readmeAtLayer1);
  // Task 63: replaces the block above; untick then retick the snapshot box on the same page.
  await validateSnapshotToggle(page);
  await saveScreenshot(page, "02-layer2");

  await validateRulerRow(page);
  // // Task 386: the real page has no bubble-click flash (#308).
  await validateBubbleFlash(page);
  await validateSessionSearch(page);
  await validateDrawer(page);

  // Tasks #324/#325/#326; each restores what it changed, so the round-trip below still matches.
  await validateDiffPair(page);
  await validatePairArrows(page);
  await validateDiffTools(page);
  await validateCrossBubbleRefusal(page);
  await saveScreenshot(page, "03-diff-pair");
  await validateNavOpensDiskNode(page);
  await validateShowOnlySelected(page);
  await validateNavBugs(page);
  await validateMultiFileDrawer(page);

  await page.evaluate(`document.getElementById('dclose').click()`);
  // await page.waitFor(`document.querySelectorAll('.n-snap').length === 0`, 10_000);
  // reportCheck("#304 1 -> 2 -> 1 lands back exactly where it started",
  //     await page.evaluate<string>(RENDER_SIGNATURE) === layer1);
}

function stopPort(port: number): void {
  execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

// Build so the page serves the current webapp, then boot the real viewer in fixture mode.
function buildWebapp(): void {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", PROJECTS_DIR, "--port", String(port), "--fixture", "--settings-file", settingsFile, "--cache-file", join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json"),
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

async function executeMain(): Promise<void> {
  buildWebapp();
  const port = await findFreePort();
  stopPort(port);
  const server = await launchViewer(port);
  const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
  try {
    const pageUrl = `http://127.0.0.1:${port}/app/layer1.html`;
    await page.navigate(pageUrl);
    // The fixture settings auto-boot the page with no real folder; wait for the first bubble.
    await page.waitFor("document.querySelectorAll('.filebox').length > 0", 30_000);
    await executeChecks(page, pageUrl);
  }
  finally {
    await page.close();
    server.kill("SIGKILL");
    stopPort(port);
  }
  console.log(failures.length
    ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
    : "\nALL CHECKS PASSED — screenshots in scripts/visual/out/");
  process.exit(failures.length ? 1 : 0);
}

await executeMain();
