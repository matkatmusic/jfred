// Headless checks for the Layer 1 + Layer 2 acceptance lines of tasks #299-#307.
//
// Task 330: re-pointed from the static mockup at the REAL page, booted in --fixture mode.
//
// The check functions run unchanged; each that fails is CLASSIFIED in implementation-notes-task-330.md.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, waitForHttp, type HeadlessPage } from "./cdp.ts";
import {
    RENDER_SIGNATURE, check, checkChrome, checkDrawer, checkNavRows, checkOrdering, checkRulerRow,
    checkScale, checkSnapshotNodes, failures, shapeOf, shoot,
} from "./mockup-checks.ts";
import { checkBubbleFlash, checkMultiFileDrawer, checkSessionSearch } from "./mockup-checks-nav.ts";
import {
    checkCrossBubbleRefusal, checkDiffPair, checkDiffTools, checkNavBugs, checkNavOpensDiskNode,
    checkPairArrows, checkShowOnlySelected,
} from "./mockup-checks-diff.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// --projects-dir stays mandatory but the fixture routes ignore it; any existing folder does.
const PROJECTS_DIR = join(JFRED_ROOT, "scripts");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;

const LAYER_BUTTON = (n: number) => `document.querySelector('[data-layer="${n}"]')`;
const CURRENT_ONLY_ON_2 =
    `${LAYER_BUTTON(2)}.classList.contains('current') && !${LAYER_BUTTON(1)}.classList.contains('current')`;

async function openLayer2(page: HeadlessPage): Promise<void> {
    await page.evaluate(`${LAYER_BUTTON(2)}.click()`);
    await page.waitFor(`document.querySelectorAll('.n-snap').length > 0`, 10_000);
    check("#304 the h1 reads the selected layer",
        await page.evaluate<string>(`document.getElementById('layer-h1').textContent`) === "Layer 2 View");
    check("#304 [2] carries .current and [1] does not", await page.evaluate<boolean>(CURRENT_ONLY_ON_2));
}

async function runChecks(page: HeadlessPage): Promise<void> {
    await checkChrome(page);
    await checkNavRows(page);
    const layer1 = await page.evaluate<string>(RENDER_SIGNATURE);
    const indexAnchor = await page.evaluate<string>(
        `document.querySelector('[data-path="src/index.ts"]').dataset.instant`);
    const readmeAtLayer1 = await page.evaluate<string>(shapeOf("README.md"));
    check("#304 Layer 1 draws no snapshot node",
        await page.evaluate<number>(`document.querySelectorAll('.n-snap').length`) === 0);
    await shoot(page, "01-layer1");

    await openLayer2(page);
    await checkScale(page);
    await checkOrdering(page);
    await checkSnapshotNodes(page, indexAnchor);
    // Its axis OFFSET may move (#251), but its own anchor and node rows must not.
    check("#304 a file with NO snapshots renders exactly as at Layer 1",
        await page.evaluate<string>(shapeOf("README.md")) === readmeAtLayer1, readmeAtLayer1);
    await shoot(page, "02-layer2");

    await checkRulerRow(page);
    await checkBubbleFlash(page);
    await checkSessionSearch(page);
    await checkDrawer(page);

    // Tasks #324/#325/#326; each restores what it changed, so the round-trip below still matches.
    await checkDiffPair(page);
    await checkPairArrows(page);
    await checkDiffTools(page);
    await checkCrossBubbleRefusal(page);
    await shoot(page, "03-diff-pair");
    await checkNavOpensDiskNode(page);
    await checkShowOnlySelected(page);
    await checkNavBugs(page);
    await checkMultiFileDrawer(page);

    await page.evaluate(`document.getElementById('dclose').click(); ${LAYER_BUTTON(1)}.click()`);
    await page.waitFor(`document.querySelectorAll('.n-snap').length === 0`, 10_000);
    check("#304 1 -> 2 -> 1 lands back exactly where it started",
        await page.evaluate<string>(RENDER_SIGNATURE) === layer1);
}

function killPort(port: number): void {
    execSync(`lsof -ti tcp:${port} | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

// Build so the page serves the current webapp, then boot the real viewer in fixture mode.
function buildWebapp(): void {
    execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

async function startViewer(port: number): Promise<ChildProcess> {
    const server = spawn("node_modules/.bin/tsx", [
        "src/viewer_server.ts", "--projects-dir", PROJECTS_DIR, "--port", String(port), "--fixture",
    ], { cwd: JFRED_ROOT, stdio: "ignore" });
    await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
    return server;
}

async function main(): Promise<void> {
    buildWebapp();
    const port = await findFreePort();
    killPort(port);
    const server = await startViewer(port);
    const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    try {
        await page.navigate(`http://127.0.0.1:${port}/app/layer1.html`);
        // The fixture settings auto-boot the page with no real folder; wait for the first bubble.
        await page.waitFor("document.querySelectorAll('.filebox').length > 0", 30_000);
        await runChecks(page);
    } finally {
        await page.close();
        server.kill("SIGKILL");
        killPort(port);
    }
    console.log(failures.length
        ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
        : "\nALL CHECKS PASSED — screenshots in scripts/visual/out/");
    process.exit(failures.length ? 1 : 0);
}

await main();
