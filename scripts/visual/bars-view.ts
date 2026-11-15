// Headless browser check of the Bars view on the real page, with fake inverse repos (no real data).

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds, type MouseHeadlessPage } from "./cdp.ts";
import { executeDotClickChecks, executeEventsButtonCheck, executeTickClickChecks } from "./bars-view-checks-click.ts";
import { executeLoadChecks } from "./bars-view-checks-load.ts";
import { executeMarkChecks } from "./bars-view-checks-marks.ts";
import { executeShowRowChecks } from "./bars-view-checks-showrow.ts";
import { checkBarsViewHidesTheBubblePage, checkRealRulerStays, checkRulerContainerScrolls, executeFailureChecks, executeSliderToBubblesChecks } from "./bars-view-checks-view.ts";
import { buildFakeErrorLines, buildFakeFiles, buildFakeStreamLines } from "./bars-view-fake-data.ts";
import { installFakeFetch } from "./bars-view-fake-fetch.ts";
import { readRulerRowTimes } from "./bars-view-page-reads.ts";
import { failures } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
// --projects-dir stays mandatory but the fixture routes ignore it; any existing folder does.
const PROJECTS_DIR = join(JFRED_ROOT, "scripts");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const PAGE_BOOTED = `document.querySelectorAll('.filebox').length > 0 && document.querySelectorAll('#timelineRulerComponent .tick').length > 0`;
const FIRST_LOAD_SETTLED = `!document.getElementById('timelineRulerComponent').classList.contains('barsRulerLoading')`;
const FIRST_LOAD_PAUSE_MS = 1500;

function stopPort(port: number): void {
    execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

function buildWebapp(): void {
    execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
}

async function launchViewer(port: number): Promise<ChildProcess> {
    const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
    writeFileSync(settingsFile, "{}");
    const cacheFile = join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json");
    const server = spawn("node_modules/.bin/tsx", [
        "src/viewer_server.ts", "--projects-dir", PROJECTS_DIR, "--port", String(port), "--fixture", "--settings-file", settingsFile, "--cache-file", cacheFile,
    ], { cwd: JFRED_ROOT, stdio: "ignore" });
    await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
    return server;
}

async function executeBarsChecks(page: MouseHeadlessPage, outDir: string): Promise<void> {
    const files = buildFakeFiles(await readRulerRowTimes(page));
    await installFakeFetch(page, buildFakeErrorLines());
    await executeLoadChecks(page, files, buildFakeStreamLines(files), outDir);
    await executeMarkChecks(page, files);
    await executeShowRowChecks(page);
    await executeTickClickChecks(page, outDir);
    await executeDotClickChecks(page);
    await executeEventsButtonCheck(page);
    await checkBarsViewHidesTheBubblePage(page);
    await checkRealRulerStays(page, "Bars view");
    await checkRulerContainerScrolls(page);
    await executeSliderToBubblesChecks(page, outDir);
    await executeFailureChecks(page);
}

async function executePageChecks(server: ChildProcess, port: number, outDir: string): Promise<void> {
    const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    try {
        await page.navigate(`http://127.0.0.1:${port}/app/layer1.html`);
        await page.waitFor(PAGE_BOOTED, 30_000);
        await waitMilliseconds(FIRST_LOAD_PAUSE_MS);
        await page.waitFor(FIRST_LOAD_SETTLED, 30_000);
        await executeBarsChecks(page, outDir);
    }
    finally {
        await page.close();
        server.kill("SIGKILL");
        stopPort(port);
    }
}

async function executeMain(): Promise<void> {
    buildWebapp();
    const port = await findFreePort();
    stopPort(port);
    const outDir = mkdtempSync(join(tmpdir(), "bars-view-"));
    console.log(`screenshots go to ${outDir}`);
    await executePageChecks(await launchViewer(port), port, outDir);
    console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}` : "\nALL BARS VIEW CHECKS PASSED");
    process.exit(failures.length ? 1 : 0);
}

await executeMain();
