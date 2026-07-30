// Task 318: the Layer 2 assertions against the REAL page.
//
// layer2.ts owns the server and data; this file only knows what "correct" looks like.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pause, type HeadlessPage } from "./cdp.ts";
import { check } from "./mockup-checks.ts";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "out");
const FADE_WAIT_MS = 3_000;

interface WireSnapshot { version: number; sessionId: string; sessionFile: string; line?: number }
interface WirePair { path: string; snapshots?: WireSnapshot[] }
export interface ViewPayload { pairs: WirePair[]; diskOrphans: { snapshots?: WireSnapshot[] }[] }

const LAYER = (n: number) => `document.querySelector('.layerbar button[data-layer="${n}"]')`;

// Every bubble's path, axis offset and node labels: the signature #314's idempotency needs.
const RENDER_SIGNATURE =
    `[...document.querySelectorAll('#stage .filebox')].map(b => (b.querySelector('.fname')?.dataset.path ?? '') + '@'
        + b.style.getPropertyValue('--axis-px') + ':'
        + [...b.querySelectorAll('.nlabel')].map(n => n.textContent).join('/')).join('|')`;

// Snapshot labels the reader can actually SEE — the nodes exist at Layer 1 but CSS hides them.
const VISIBLE_SNAP_LABELS =
    `[...document.querySelectorAll('.nlabel.n-snap')].filter(n => n.offsetParent !== null).map(n => n.textContent)`;

async function shoot(page: HeadlessPage, name: string): Promise<void> {
    writeFileSync(join(OUT_DIR, `layer2-${name}.png`), Buffer.from(await page.screenshot(), "base64"));
}

function expectedSnapTotal(payload: ViewPayload): number {
    return payload.pairs.reduce((n, p) => n + (p.snapshots?.length ?? 0), 0)
        + payload.diskOrphans.reduce((n, o) => n + (o.snapshots?.length ?? 0), 0);
}

// The owning-session basenames the payload says a snapshot came from — what a flash must match.
function ownerBasenames(payload: ViewPayload): Set<string> {
    const files = payload.pairs.flatMap((p) => (p.snapshots ?? []).map((s) => s.sessionFile));
    return new Set(files.map((f) => f.split("/").pop() ?? f));
}

// The flash fades after 2.6s; poll briefly so a read never races its arrival.
async function readFlashFile(page: HeadlessPage): Promise<string | null> {
    await page.waitFor(`document.querySelector('.session-item.flash')`, 2_000).catch(() => {});
    return page.evaluate<string | null>(`document.querySelector('.session-item.flash')?.dataset.file ?? null`);
}

async function checkChrome(page: HeadlessPage): Promise<void> {
    const buttons = await page.evaluate<string[]>(
        `[...document.querySelectorAll('.layerbar button[data-layer]')].map(b => b.textContent)`);
    check("#314 the layer row is exactly [1][2]", JSON.stringify(buttons) === '["1","2"]', buttons);
    check("#314 nothing is left dimmed as uncomputed",
        await page.evaluate<number>(`document.querySelectorAll('.layerbar button.uncomputed').length`) === 0);
    check("#314 [2] names file-history snapshots",
        await page.evaluate<string>(`${LAYER(2)}.title`) === "Layer 2 adds file-history snapshots");
}

async function checkLayer1HidesSnapshots(page: HeadlessPage): Promise<void> {
    check("#314 the page opens on Layer 1",
        await page.evaluate<string>(`document.querySelector('.viz-root').dataset.layer`) === "1");
    check("#312 snapshot nodes are always in the DOM (shipped, not refetched)",
        await page.evaluate<number>(`document.querySelectorAll('.node.n-snap').length`) > 0);
    check("#314 at Layer 1 no snapshot node is visible",
        (await page.evaluate<string[]>(VISIBLE_SNAP_LABELS)).length === 0);
}

async function openLayer2(page: HeadlessPage): Promise<void> {
    await page.evaluate(`${LAYER(2)}.click()`);
    await page.waitFor(`document.querySelector('.viz-root').dataset.layer === "2"`, 5_000);
    check("#314 [2] carries .current and [1] does not", await page.evaluate<boolean>(
        `${LAYER(2)}.classList.contains('current') && !${LAYER(1)}.classList.contains('current')`));
}

async function checkSnapshotNodes(page: HeadlessPage, payload: ViewPayload): Promise<void> {
    const labels = await page.evaluate<string[]>(VISIBLE_SNAP_LABELS);
    const total = expectedSnapTotal(payload);
    check("#315 one visible '@vN 📸' node per snapshot the payload shipped",
        labels.length === total && labels.every((t) => /^@v\d+ 📸$/.test(t)), { drawn: labels.length, total });
    check("#315 the legend carries a snapshot swatch", await page.evaluate<boolean>(
        `[...document.querySelectorAll('.legend span')].some(s => s.textContent.includes('📸'))`));
    const bare = payload.pairs.find((p) => (p.snapshots?.length ?? 0) === 0)?.path;
    if (bare !== undefined) {
        check("#314 a snapshot-free file's bubble shows no 📸", await page.evaluate<boolean>(
            `[...document.querySelectorAll('.filebox .fname[data-path=${JSON.stringify(bare)}]')]
             .flatMap(f => [...f.closest('.filebox').querySelectorAll('.nlabel')].map(n => n.textContent))
             .every(t => !t.includes('📸'))`), bare);
    }
}

// Walk the expandable ruler rows until one lists a snapshot; leaves that row open on return.
async function expandSnapshotRow(page: HeadlessPage): Promise<{ snap: string; count: number } | null> {
    const ticks = await page.evaluate<number>(`document.querySelectorAll('#ruler .tick.multi').length`);
    for (let i = 0; i < ticks; i++) {
        await page.evaluate(`document.querySelectorAll('#ruler .tick.multi')[${i}].click()`);
        await page.waitFor(`document.querySelectorAll('.tickfiles button').length > 0`, 5_000).catch(() => {});
        const rows = await page.evaluate<string[]>(
            `[...document.querySelectorAll('.tickfiles button')].map(b => b.textContent)`);
        const snap = rows.find((t) => t.includes("📸"));
        if (snap !== undefined) {
            return { snap, count: rows.length };
        }
        await page.evaluate(`document.querySelector('#ruler .tick.expanded')?.click()`);
        await pause(120);
    }
    return null;
}

async function checkRulerRow(page: HeadlessPage, payload: ViewPayload): Promise<void> {
    const found = await expandSnapshotRow(page);
    check("#316 an expandable ruler row lists a snapshot as '<file> @vN 📸'",
        found !== null && /📸$/.test(found.snap), found);
    if (found === null) {
        return;
    }
    await page.evaluate(
        `[...document.querySelectorAll('.tickfiles button')].find(b => b.textContent.includes('📸')).click()`);
    const flashFile = await readFlashFile(page);
    const selected = await page.evaluate<number>(`document.querySelectorAll('.session-item.selected').length`);
    check("#303 clicking a snapshot row flashes exactly one JSONL",
        await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 1, flashFile);
    check("#303 the flashed row is a real owning session from the payload",
        flashFile !== null && ownerBasenames(payload).has(flashFile), flashFile);
    check("#303 the flash highlights, it does not select (nothing filtered)", selected === 0, selected);
    await shoot(page, "03-ruler-flash");
    await pause(FADE_WAIT_MS);
    check("#303 the highlight fades out on its own",
        await page.evaluate<number>(`document.querySelectorAll('.session-item.flash').length`) === 0);
    await page.evaluate(`document.querySelector('#ruler .tick.expanded')?.click()`);
    await pause(200);
}

async function checkDrawer(page: HeadlessPage): Promise<void> {
    const owner = await page.evaluate<string>(`(() => {
        const n = [...document.querySelectorAll('.node.n-snap')].find(n => n.offsetParent !== null);
        n.click();
        return (n.dataset.sessionFile ?? '').split('/').pop();
    })()`);
    await page.waitFor(`document.getElementById('drawer').classList.contains('open')`, 5_000);
    await page.waitFor(`document.getElementById('dbody').textContent.trim().length > 0`, 8_000);
    const drawer = await page.evaluate<{ head: string; meta: string; body: string }>(
        `({ head: document.getElementById('dpath').textContent,
            meta: document.getElementById('dmeta').textContent,
            body: document.getElementById('dbody').textContent })`);
    check("#305 the header reads '<file> Snapshot' (with '- <title>' when the session has one)",
        /^\S+ Snapshot( - .+)?$/.test(drawer.head), drawer.head);
    check("#305 the drawer names the owning session",
        drawer.meta.includes("file-history @v") && drawer.meta.includes(owner), drawer.meta);
    check("#305 the snapshot's bytes render", drawer.body.trim().length > 0, drawer.body.slice(0, 60));
    check("#317 clicking a snapshot node flashes its JSONL", await readFlashFile(page) === owner, owner);
    await shoot(page, "04-drawer");
    await pause(FADE_WAIT_MS);
}

export async function runLayer2Checks(page: HeadlessPage, payload: ViewPayload): Promise<void> {
    await checkChrome(page);
    await checkLayer1HidesSnapshots(page);
    const layer1Signature = await page.evaluate<string>(RENDER_SIGNATURE);
    await shoot(page, "01-layer1");

    await openLayer2(page);
    await checkSnapshotNodes(page, payload);
    await shoot(page, "02-layer2");
    await checkRulerRow(page, payload);
    await checkDrawer(page);

    await page.evaluate(`document.getElementById('dclose').click(); ${LAYER(1)}.click()`);
    await page.waitFor(`document.querySelector('.viz-root').dataset.layer === "1"`, 5_000);
    check("#314 at Layer 1 again no snapshot node is visible",
        (await page.evaluate<string[]>(VISIBLE_SNAP_LABELS)).length === 0);
    check("#314 1 -> 2 -> 1 lands back exactly where it started",
        await page.evaluate<string>(RENDER_SIGNATURE) === layer1Signature);
}
