// Headless browser pass of the Bars view on the real scenario s87-demo-composite: it only looks (rows, dots, status line) and clicks nothing.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Path } from "../../src/structures/domain.ts";
import { getInverseReposStoreFolder } from "../../src/viewer_api_layer1_inverse_repos.ts";
import { listStepFolders, readStepStateFiles } from "../step_state_files.ts";
import { countElements, saveBarsScreenshot } from "./bars-view-page-reads.ts";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds, type MouseHeadlessPage } from "./cdp.ts";
import { failures, reportCheck } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCENARIOS_FOLDER = "/Users/matkatmusicllc/Desktop/claude code src/RevEng/jfred/scenarios";
const SCENARIO_FOLDER = new Path(join(SCENARIOS_FOLDER, "executed", "s87-demo-composite"));
const SNAPSHOTS_FOLDER = new Path(join(SCENARIOS_FOLDER, "file-history"));
const RECORDED_ROOT = "/private/var/folders/fy/wg2tzrv957sg2vqjcvdkdzvm0000gn/T/run-scenario.7y52smqe";
const RECORDED_ROOT_WITHOUT_PRIVATE = RECORDED_ROOT.replace("/private", "");
const VIEWPORT_WIDTH = 1600;
const VIEWPORT_HEIGHT = 1000;
const LOAD_TIME_LIMIT_MS = 100_000;
const LOAD_POLL_MS = 250;
const RULER_IS_LOADING = `document.getElementById('timelineRulerComponent').classList.contains('barsRulerLoading')`;
const STATUS_LINE_TEXT = `document.getElementById('barsStatusLine').textContent`;
const IS_HISTORY_COMPLETE = `!(${RULER_IS_LOADING}) && ${STATUS_LINE_TEXT}.includes('Change history is complete')`;
// An unhandled rejection is how a stream error line surfaces in the Bars load; the crumb shows errors of the main view.
const ERROR_TEXT = `(window.__barsErrors.join(' | ') + (/^\\w*Error/.test(document.getElementById('crumb').textContent) ? document.getElementById('crumb').textContent : ''))`;
const OPEN_POPUP_COUNT = `document.querySelectorAll('.modal-wrap:not([hidden]), dialog[open]').length`;

function copyLastStepProject(projectFolder: Path): void {
    const stepStatesFolder = join(SCENARIO_FOLDER.toString(), ".step_states");
    const stepNames = listStepFolders(stepStatesFolder);
    const lastStepName = stepNames[stepNames.length - 1]!;
    console.log(`project files come from ${lastStepName}`);
    mkdirSync(projectFolder.toString());
    for (const [relativePath, text] of readStepStateFiles(join(stepStatesFolder, lastStepName))) {
        mkdirSync(dirname(join(projectFolder.toString(), relativePath)), { recursive: true });
        writeFileSync(join(projectFolder.toString(), relativePath), text);
    }
    cpSync(join(SCENARIO_FOLDER.toString(), ".git"), join(projectFolder.toString(), ".git"), { recursive: true });
}

function copyRewrittenTranscripts(jsonlFolder: Path, projectFolder: Path): void {
    mkdirSync(jsonlFolder.toString());
    const transcriptNames = readdirSync(SCENARIO_FOLDER.toString()).filter((name) => name.endsWith(".jsonl"));
    for (const transcriptName of transcriptNames) {
        const text = readFileSync(join(SCENARIO_FOLDER.toString(), transcriptName), "utf8");
        const rewrittenText = text.replaceAll(RECORDED_ROOT, projectFolder.toString()).replaceAll(RECORDED_ROOT_WITHOUT_PRIVATE, projectFolder.toString());
        writeFileSync(join(jsonlFolder.toString(), transcriptName), rewrittenText);
    }
    console.log(`${transcriptNames.length} transcripts copied with the project path rewritten`);
}

// Same flags as layer6-real-viewer-args.ts, but the folders here are not named projects/ and file-history/.
function buildRealViewerArguments(tmpFolder: Path, port: number): string[] {
    const tmp = tmpFolder.toString();
    return [
        "--import", "tsx", "src/viewer_server.ts", "--projects-dir", tmp, "--file-history-dir", SNAPSHOTS_FOLDER.toString(), "--port", String(port),
        "--settings-file", join(tmp, "settings.json"), "--cache-file", join(tmp, "cache.json"),
        "--sandbox-memo-file", join(tmp, "sandbox-memo.json"), "--run-results-file", join(tmp, "run-results.json"),
    ];
}

async function launchViewer(tmpFolder: Path, port: number): Promise<ChildProcess> {
    writeFileSync(join(tmpFolder.toString(), "settings.json"), "{}");
    const server = spawn("node", buildRealViewerArguments(tmpFolder, port), { cwd: JFRED_ROOT, stdio: ["ignore", "ignore", "inherit"] });
    await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
    return server;
}

function buildPageUrl(port: number, projectFolder: Path, jsonlFolder: Path): string {
    const params = new URLSearchParams({ dir: projectFolder.toString(), repo: projectFolder.toString() });
    params.append("jsonl", jsonlFolder.toString());
    params.append("snapshots", SNAPSHOTS_FOLDER.toString());
    return `http://127.0.0.1:${port}/app/layer1.html?${params.toString()}`;
}

async function waitForLoadEnd(page: MouseHeadlessPage, deadline: number): Promise<boolean> {
    while (Date.now() < deadline) {
        const hasEnded = await page.evaluate<boolean>(`(${IS_HISTORY_COMPLETE}) || ${ERROR_TEXT} !== ''`);
        if (hasEnded) {
            return true;
        }
        await waitMilliseconds(LOAD_POLL_MS);
    }
    return false;
}

async function executeLoadChecks(page: MouseHeadlessPage, loadStartedAt: number, deadline: number): Promise<void> {
    const hasEnded = await waitForLoadEnd(page, deadline);
    const loadSeconds = (Date.now() - loadStartedAt) / 1000;
    console.log(`load wait ended after ${loadSeconds} s (ended: ${hasEnded})`);
    const isComplete = await page.evaluate<boolean>(IS_HISTORY_COMPLETE);
    reportCheck("load ends: ruler has no barsRulerLoading and #barsStatusLine says Change history is complete", isComplete, await page.evaluate<string>(STATUS_LINE_TEXT));
    const errorText = await page.evaluate<string>(ERROR_TEXT);
    reportCheck("no error line shows", errorText === "", errorText);
}

async function executeCountChecks(page: MouseHeadlessPage): Promise<void> {
    const rowCount = await countElements(page, ".barsFileRow");
    reportCheck(`.barsFileRow count > 0 (count ${rowCount})`, rowCount > 0, rowCount);
    const dotCount = await countElements(page, ".BarDot");
    reportCheck(`.BarDot count > 0 (count ${dotCount})`, dotCount > 0, dotCount);
    console.log(`open popups or dialogs seen: ${await page.evaluate<number>(OPEN_POPUP_COUNT)}`);
}

async function installLogFileLineRecorder(page: MouseHeadlessPage): Promise<void> {
    await page.waitFor(`document.getElementById('barsLogFileLine') !== null`, 30_000);
    await page.evaluate(`(window.__logFileNames = [], new MutationObserver(() => {
        const text = document.getElementById('barsLogFileLine').textContent;
        if (text !== '') window.__logFileNames.push({ text, at: performance.now() });
    }).observe(document.getElementById('barsLogFileLine'), { childList: true }), true)`);
}

function median(sortedNumbers: number[]): number {
    return sortedNumbers[Math.floor(sortedNumbers.length / 2)]!;
}

async function reportLogFileNameTimings(page: MouseHeadlessPage): Promise<void> {
    const names = await page.evaluate<{ text: string; at: number }[]>("window.__logFileNames");
    const gaps = names.slice(1).map((name, index) => name.at - names[index]!.at).sort((a, b) => a - b);
    console.log(`log file names shown: ${names.length}; first ${names[0]?.text}`);
    console.log(`gap ms between names: min ${gaps[0]}, median ${median(gaps)}, max ${gaps[gaps.length - 1]}`);
}

async function executePageChecks(url: string, shotsFolder: string, deadline: number): Promise<void> {
    const page = await openHeadlessPage(VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    try {
        const loadStartedAt = Date.now();
        await page.navigate(url);
        await installLogFileLineRecorder(page);
        await page.evaluate(`(window.__barsErrors = [], addEventListener('unhandledrejection', (event) => window.__barsErrors.push(String(event.reason))), true)`);
        await executeLoadChecks(page, loadStartedAt, deadline);
        await reportLogFileNameTimings(page);
        await executeCountChecks(page);
        await saveBarsScreenshot(page, shotsFolder, "real-after-load");
    }
    finally {
        await page.close();
    }
}

async function executeWithViewer(tmpFolder: Path, shotsFolder: string, deadline: number): Promise<void> {
    execFileSync("node_modules/.bin/tsc", ["-p", "tsconfig.webapp.json"], { cwd: JFRED_ROOT, stdio: "inherit" });
    const port = await findFreePort();
    const server = await launchViewer(tmpFolder, port);
    try {
        const projectFolder = new Path(join(tmpFolder.toString(), "project"));
        await executePageChecks(buildPageUrl(port, projectFolder, new Path(join(tmpFolder.toString(), "jsonl"))), shotsFolder, deadline);
    }
    finally {
        server.kill("SIGKILL");
        await waitMilliseconds(200);
    }
}

function removeStoreEntry(projectFolder: Path): void {
    const storeFolder = getInverseReposStoreFolder(projectFolder).toString();
    const wasPresent = existsSync(storeFolder);
    rmSync(storeFolder, { recursive: true, force: true });
    console.log(`store entry ${storeFolder} existed: ${wasPresent}; removed`);
}

function cleanUp(tmpFolder: Path, projectFolder: Path): void {
    rmSync(tmpFolder.toString(), { recursive: true, force: true });
    console.log(`tmp folder ${tmpFolder.toString()} removed: ${!existsSync(tmpFolder.toString())}`);
    removeStoreEntry(projectFolder);
}

async function executeInTmpFolder(tmpFolder: Path, shotsFolder: string, deadline: number): Promise<void> {
    const projectFolder = new Path(join(tmpFolder.toString(), "project"));
    try {
        copyLastStepProject(projectFolder);
        copyRewrittenTranscripts(new Path(join(tmpFolder.toString(), "jsonl")), projectFolder);
        await executeWithViewer(tmpFolder, shotsFolder, deadline);
    }
    finally {
        cleanUp(tmpFolder, projectFolder);
    }
}

async function executeMain(): Promise<void> {
    const deadline = Date.now() + LOAD_TIME_LIMIT_MS;
    const tmpFolder = new Path(realpathSync(mkdtempSync(join(tmpdir(), "bars-view-real-"))));
    const shotsFolder = mkdtempSync(join(tmpdir(), "bars-view-real-shots-"));
    console.log(`screenshots go to ${shotsFolder}`);
    await executeInTmpFolder(tmpFolder, shotsFolder, deadline);
    console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}` : "\nALL REAL BARS VIEW CHECKS PASSED");
    process.exit(failures.length ? 1 : 0);
}

await executeMain();
