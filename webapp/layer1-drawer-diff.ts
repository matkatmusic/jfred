// Task 305: shift-click a second node on the same bubble's lane to diff two revisions in the drawer.

import { el, getInputById, getRequiredElementById } from "./app-dom.ts";
import { appendColumnsDiff, appendInlineDiff } from "./diff-render.ts";
import { renderFileContentInto } from "./layer1-file-view.ts";

const SHORT_HASH_LENGTH = 8;
const TOAST_MILLISECONDS = 2600;

// The drawer's own display modes; "full" shows the TARGET side's content.
const DrawerDiffMode = Object.freeze({ side: "side", inline: "inline", full: "full" } as const);
type DrawerDiffModeValue = (typeof DrawerDiffMode)[keyof typeof DrawerDiffMode];

type DiffSide = { node: HTMLElement; hash: string | undefined };
type DiffPair = { path: string; base: DiffSide; target: DiffSide };

let shownPair: DiffPair | undefined;
let shownDiffText = "";
let mode: DrawerDiffModeValue = DrawerDiffMode.side;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

// A commit node carries its full hash on the dot's `title`; anything else diffs as the working tree.
export function nodeCommitHash(node: HTMLElement): string | undefined {
    return node.classList.contains("n-commit") && node.title !== "" ? node.title : undefined;
}

// ONE control strip (tasks 299/305): the header shows the tools for what the body holds.
export function setDrawerTools(tools: "img" | "diff" | "none"): void {
    getRequiredElementById("imgtools").hidden = tools !== "img";
    getRequiredElementById("difftools").hidden = tools !== "diff";
}

// The refusal is VISIBLE, never a silent no-op (task 305).
function flashToast(text: string): void {
    const toast = getRequiredElementById("dtoast");
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, TOAST_MILLISECONDS);
}

export function clearDiffPair(): void {
    shownPair = undefined;
    for (const marked of document.querySelectorAll(".diff-base, .diff-target")) {
        marked.classList.remove("diff-base", "diff-target");
    }
}

// A node's place on its lane's time axis (layer1-widgets.ts's --axis-px).
function readAxisPx(node: HTMLElement): number {
    return Number(node.style.getPropertyValue("--axis-px")) || 0;
}

function describeSideName(side: DiffSide): string {
    return side.hash === undefined ? "on disk" : side.hash.slice(0, SHORT_HASH_LENGTH);
}

// /api/layer1-file params for one side — the same forms a plain click builds.
function buildSideFileParams(path: string, side: DiffSide): URLSearchParams {
    if (side.hash === undefined) {
        return new URLSearchParams({ dir: getInputById("dir").value.trim(), path });
    }
    return new URLSearchParams({ repo: getInputById("repo").value.trim(), path, hash: side.hash });
}

function buildDiffParams(pair: DiffPair): URLSearchParams {
    const params = new URLSearchParams({ path: pair.path });
    if (pair.base.hash !== undefined) params.set("baseHash", pair.base.hash);
    if (pair.target.hash !== undefined) params.set("targetHash", pair.target.hash);
    if (pair.base.hash === undefined || pair.target.hash === undefined) {
        params.set("dir", getInputById("dir").value.trim());
    }
    if (pair.base.hash !== undefined || pair.target.hash !== undefined) {
        params.set("repo", getInputById("repo").value.trim());
    }
    return params;
}

function paintModeButtons(): void {
    for (const button of getRequiredElementById("difftools").querySelectorAll<HTMLElement>("button[data-mode]")) {
        button.classList.toggle("current", button.dataset.mode === mode);
    }
}

// "full content" = the target side's bytes, the same text view a plain click shows.
async function renderTargetContent(body: HTMLElement, pair: DiffPair): Promise<void> {
    body.textContent = "loading…";
    const response = await fetch(`/api/layer1-file?${buildSideFileParams(pair.path, pair.target)}`);
    if (!response.ok) {
        body.textContent = await response.text();
        return;
    }
    renderFileContentInto(body, (await response.json() as { content: string }).content, pair.path);
}

async function renderDiffBody(): Promise<void> {
    if (shownPair === undefined) {
        return;
    }
    paintModeButtons();
    const body = getRequiredElementById("dbody");
    if (mode === DrawerDiffMode.full) {
        await renderTargetContent(body, shownPair);
        return;
    }
    if (shownDiffText === "") {
        body.replaceChildren(el("div", { class: "dbinary", text: "No text differences between these revisions." }));
        return;
    }
    body.replaceChildren();
    (mode === DrawerDiffMode.inline ? appendInlineDiff : appendColumnsDiff)(body, shownDiffText, shownPair.path);
}

async function openDiffDrawer(pair: DiffPair): Promise<void> {
    const basename = pair.path.split("/").pop() ?? pair.path;
    const header = getRequiredElementById("dpath");
    header.textContent = `${basename} — ${describeSideName(pair.base)} → ${describeSideName(pair.target)}`;
    header.title = pair.path;
    getRequiredElementById("dmeta").textContent = `${pair.path}   ·   base ${describeSideName(pair.base)} → target ${describeSideName(pair.target)}`;
    setDrawerTools("diff");
    getRequiredElementById("drawer").classList.add("open");
    const body = getRequiredElementById("dbody");
    body.textContent = "loading…";
    const response = await fetch(`/api/layer1-diff?${buildDiffParams(pair)}`);
    if (!response.ok) {
        body.textContent = await response.text();
        return;
    }
    shownDiffText = (await response.json() as { diff: string }).diff;
    await renderDiffBody();
}

// The second, shift-clicked node; the pair's direction comes from axis position, never click order.
export async function extendDiffSelection(anchor: { node: HTMLElement; path: string }, node: HTMLElement, path: string): Promise<void> {
    if (anchor.node.closest(".filebox") !== node.closest(".filebox")) {
        flashToast(`diff needs two nodes on ONE bubble — ${anchor.path.split("/").pop()} is selected`);
        return;
    }
    if (anchor.node === node) {
        return;
    }
    const [baseNode, targetNode] = readAxisPx(anchor.node) <= readAxisPx(node) ? [anchor.node, node] : [node, anchor.node];
    clearDiffPair();
    // The pair's marks replace the single-selection `.found` marks.
    for (const lit of document.querySelectorAll(".found")) {
        lit.classList.remove("found");
    }
    baseNode.classList.add("diff-base");
    targetNode.classList.add("diff-target");
    shownPair = {
        path,
        base: { node: baseNode, hash: nodeCommitHash(baseNode) },
        target: { node: targetNode, hash: nodeCommitHash(targetNode) },
    };
    await openDiffDrawer(shownPair);
}

// "export as patch": headers + hunks make one git-apply-able file patch (task 218's shape).
function exportPatch(): void {
    if (shownPair === undefined || shownDiffText === "") {
        flashToast("no differences to export");
        return;
    }
    const path = shownPair.path;
    const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${shownDiffText}\n`;
    const link = el("a") as HTMLAnchorElement;
    link.href = URL.createObjectURL(new Blob([patch], { type: "text/x-patch" }));
    link.download = `${path.split("/").pop()}.patch`;
    link.click();
    URL.revokeObjectURL(link.href);
}

// Wired once (wireNodeDrawer); the buttons live in the drawer header's #difftools strip.
export function wireDiffTools(): void {
    for (const button of getRequiredElementById("difftools").querySelectorAll<HTMLElement>("button[data-mode]")) {
        button.addEventListener("click", () => {
            mode = button.dataset.mode as DrawerDiffModeValue;
            void renderDiffBody();
        });
    }
    getRequiredElementById("dexport").addEventListener("click", exportPatch);
}
