// Copy-link check on jot data: a link copied from the drawer reopens the same node.

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePort, openHeadlessPage, waitForHttp, waitMilliseconds, type HeadlessPage } from "./cdp.ts";
import { failures, reportCheck } from "./mockup-checks.ts";

const JFRED_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const JOT_RECOVERY_DIR = "/Users/matkatmusicllc/Programming/jot-recovery/claude-data";
const JOT_REPO = "/Users/matkatmusicllc/Programming/jot";
const SHOT_DIR = process.env["NODE_LINK_SHOT_DIR"] ?? join(JFRED_ROOT, "scripts", "visual", "out");
const TIMEOUT_MS = 600_000;
const USER_EXAMPLE = {
  nodeInstant: "2026-04-25T21:01:39.913Z",
  nodeSession: "/Users/matkatmusicllc/Programming/jot-recovery/claude-data/projects/-Users-matkatmusicllc-Programming-jot/684c147c-375f-449f-8e32-3847c8cb94ab.jsonl",
  nodeLine: "2235",
};

const DRAWER_OPEN = `document.getElementById('drawer').classList.contains('open') && document.querySelector('#drawer .scriptbody pre')?.textContent.length > 0`;
const READ_DRAWER_META = `Object.fromEntries([...document.querySelectorAll('#drawer dl.script-meta dt')].map(t => [t.textContent, t.nextElementSibling.textContent]))`;
const STUB_CLIPBOARD = `window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => { window.__copied.push(t); } } })`;

function stopPort(port: number): void {
  execSync(`lsof -ti tcp:${port} -sTCP:LISTEN | xargs kill -9 2>/dev/null || true`, { stdio: "ignore", shell: "/bin/sh" });
}

async function launchViewer(port: number): Promise<ChildProcess> {
  const settingsFile = join(mkdtempSync(join(tmpdir(), "jfred-settings-")), "settings.json");
  writeFileSync(settingsFile, "{}");
  const server = spawn("node_modules/.bin/tsx", [
    "src/viewer_server.ts", "--projects-dir", join(JOT_RECOVERY_DIR, "projects"),
    "--file-history-dir", join(JOT_RECOVERY_DIR, "file-history"), "--port", String(port), "--settings-file", settingsFile, "--cache-file", join(mkdtempSync(join(tmpdir(), "jfred-cache-")), "cache.json"),
  ], { cwd: JFRED_ROOT, stdio: "ignore" });
  await waitForHttp(`http://127.0.0.1:${port}/app/layer1.html`, 30_000);
  return server;
}

export function buildPageUrl(port: number, extra: Record<string, string>): string {
  const params = new URLSearchParams({ dir: JOT_REPO, repo: JOT_REPO, ...extra });
  params.append("jsonl", join(JOT_RECOVERY_DIR, "projects", "-Users-matkatmusicllc-Programming-jot"));
  return `http://127.0.0.1:${port}/app/layer1.html?${params}`;
}

async function saveShot(page: HeadlessPage, name: string): Promise<void> {
  mkdirSync(SHOT_DIR, { recursive: true });
  writeFileSync(join(SHOT_DIR, `node-link-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
}

async function copyLinkOfFirstScriptNode(page: HeadlessPage, port: number): Promise<string> {
  await page.navigate(buildPageUrl(port, {}));
  await page.waitFor("document.querySelectorAll('#stage .filebox').length > 0", TIMEOUT_MS);
  await page.evaluate(STUB_CLIPBOARD);
  await page.evaluate(`document.getElementById('layer-4').click()`);
  await page.waitFor("document.querySelectorAll('i.node.n-script[data-line]').length > 0 && document.getElementById('busy-shield').hidden", TIMEOUT_MS);
  reportCheck("node-link the copy button is hidden before any node opens", await page.evaluate<boolean>(`document.getElementById('dcopylink').hidden`));
  await page.evaluate(`document.querySelector('i.node.n-script[data-line]').click()`);
  await page.waitFor(DRAWER_OPEN, TIMEOUT_MS);
  reportCheck("node-link the copy button shows with a script node open", !(await page.evaluate<boolean>(`document.getElementById('dcopylink').hidden`)));
  await page.evaluate(`document.getElementById('dcopylink').click()`);
  await page.waitFor("window.__copied.length === 1", 5_000);
  reportCheck("node-link the button reads Copied after a copy", await page.evaluate<string>(`document.getElementById('dcopylink').textContent`) === "Copied");
  await saveShot(page, "1-source-drawer");
  return (await page.evaluate<string[]>(`window.__copied`))[0]!;
}

async function assertLinkOpensSameNode(page: HeadlessPage, port: number, link: string): Promise<void> {
  const source = await page.evaluate<Record<string, string>>(READ_DRAWER_META);
  const url = new URL(link);
  reportCheck("node-link the link names this page and the node's instant, session and line",
    url.pathname === "/app/layer1.html" && url.searchParams.get("nodeInstant") === source["instant"]
    && url.searchParams.get("nodeSession") === source["session"] && url.searchParams.get("nodeLine") === source["line"], link);
  reportCheck("node-link the link keeps dir, repo and jsonl",
    url.searchParams.get("dir") === JOT_REPO && url.searchParams.get("repo") === JOT_REPO && url.searchParams.getAll("jsonl").length === 1, link);
  await page.navigate(link.replace(url.origin, `http://127.0.0.1:${port}`));
  await page.waitFor(DRAWER_OPEN, TIMEOUT_MS);
  const opened = await page.evaluate<Record<string, string>>(READ_DRAWER_META);
  reportCheck("node-link a fresh page opens the drawer on the same instant, session and line",
    opened["instant"] === source["instant"] && opened["session"] === source["session"] && opened["line"] === source["line"], { source, opened });
  reportCheck("node-link the node params leave the address bar after the load",
    !(await page.evaluate<string>(`location.search`)).includes("nodeInstant"));
  await saveShot(page, "2-opened-from-link");
}

async function assertUserExampleOpens(page: HeadlessPage, port: number): Promise<void> {
  await page.navigate(buildPageUrl(port, USER_EXAMPLE));
  await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, TIMEOUT_MS);
  const header = await page.evaluate<string>(`document.getElementById('dpath').textContent.trim()`);
  reportCheck("node-link the user's example link (line 2235) opens a drawer", header !== "", header);
  await saveShot(page, "3-user-example");
}

async function executeMain(): Promise<void> {
  execSync("node_modules/.bin/tsc -p tsconfig.webapp.json", { cwd: JFRED_ROOT, stdio: "inherit" });
  const port = await findFreePort();
  stopPort(port);
  const server = await launchViewer(port);
  const page = await openHeadlessPage(1600, 1000);
  try {
    const link = await copyLinkOfFirstScriptNode(page, port);
    await assertLinkOpensSameNode(page, port, link);
    await assertUserExampleOpens(page, port);
  }
  finally {
    await page.close();
    server.kill("SIGKILL");
    await waitMilliseconds(200);
    stopPort(port);
  }
  console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join("\n  ")}` : "\nALL NODE-LINK CHECKS PASSED");
  process.exit(failures.length ? 1 : 0);
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  await executeMain();
}
