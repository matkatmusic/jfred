// Headless checks for the Layer 1 + Layer 2 MOCKUP at ../plans/layer2-mockup/ — not the app.
//
// Sibling of run.ts, not a replacement: run.ts boots src/viewer_server.ts and walks the REAL viewer
// through six states with reconstructed data; this serves three static files and checks the Layer 2
// acceptance lines of tasks #299-#307. Both borrow the same cdp.ts driver.
//
// A static server, not `file://` — the mockup is ES modules now, and modules do not load off file://.

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, waitForHttp, type HeadlessPage } from "./cdp.ts";
import {
    RENDER_SIGNATURE, check, checkChrome, checkDrawer, checkNavRows, checkOrdering, checkRulerRow,
    checkScale, checkSnapshotNodes, failures, shapeOf, shoot,
} from "./mockup-checks.ts";
import { checkBubbleFlash, checkSessionSearch } from "./mockup-checks-nav.ts";
import {
    checkCrossBubbleRefusal, checkDiffPair, checkDiffTools, checkNavBugs, checkNavOpensDiskNode,
    checkPairArrows, checkShowOnlySelected,
} from "./mockup-checks-diff.ts";

const MOCKUP_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../plans/layer2-mockup");
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
    // Its axis OFFSET does move — a new instant above it lengthens the ladder (#251). Its own anchor
    // and node rows must not.
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

    await page.evaluate(`document.getElementById('dclose').click(); ${LAYER_BUTTON(1)}.click()`);
    await page.waitFor(`document.querySelectorAll('.n-snap').length === 0`, 10_000);
    check("#304 1 -> 2 -> 1 lands back exactly where it started",
        await page.evaluate<string>(RENDER_SIGNATURE) === layer1);
}

async function main(): Promise<void> {
    const port = await findFreePort();
    const server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"],
        { cwd: MOCKUP_DIR, stdio: "ignore" });
    const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    try {
        await waitForHttp(`http://127.0.0.1:${port}/index.html`, 15_000);
        await page.navigate(`http://127.0.0.1:${port}/index.html`);
        // A fixture that fails its own self-check throws before anything renders, so this wait is
        // also the assertion that the fixture loaded at all.
        await page.waitFor("document.querySelectorAll('.filebox').length > 0", 15_000);
        await runChecks(page);
    } finally {
        await page.close();
        server.kill("SIGKILL");
    }
    console.log(failures.length
        ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}`
        : "\nALL CHECKS PASSED — screenshots in scripts/visual/out/");
    process.exit(failures.length ? 1 : 0);
}

await main();
