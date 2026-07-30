// Task 257.5: the Detail View drawer; delegated on #stage since bubbles rebuild per render (wireLeaderVisibility's precedent).

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { DiffPaneMode } from "./layer1-diff-pane.ts";
import { buildDiffView, displayDetailView } from "./layer1-diff-view.ts";
import { isImagePath, renderImageInto, wireImageZoomTools } from "./layer1-drawer-image.ts";
import { clearDiffPair, describeNodeStep, nodeCommitHash, setDrawerTools } from "./layer1-drawer-diff.ts";
import { extendDiffSelection } from "./layer1-drawer-multi.ts";
import { flashSession } from "./layer1-sessions.ts";

const SHORT_HASH_LENGTH = 8;

// Task 305: the last plainly-clicked node — the diff pair's anchor.
let anchor: { node: HTMLElement; path: string } | undefined;

// The clicked node, or undefined; a label opens too, and its dot is its previous sibling (appendAxisNode's order).
function findClickedNode(target: HTMLElement): HTMLElement | undefined {
    const hit = target.closest(".node, .nlabel");
    const node = hit?.classList.contains("nlabel") === true ? hit.previousElementSibling : hit;
    // A bucket row has no dot, so a `.nlabel` there (or anywhere) resolves to a non-node sibling.
    return node?.classList.contains("node") === true ? node as HTMLElement : undefined;
}

// The full path lives on the owning bubble's `.fname` data-path (task 280); a bucket row has none.
function findNodePath(node: HTMLElement): string | undefined {
    const nameElement = node.closest(".filebox")?.querySelector(".fname") as HTMLElement | null;
    return nameElement?.dataset.path;
}

// A commit node carries its full hash on the dot's `title`; an on-disk node has none.
//
// An empty title means "no commit" — a blank `hash=` would 400 naming the wrong parameter.
function describeNode(node: HTMLElement, path: string): { params: URLSearchParams; head: string; meta: string; flashFile?: string } {
    const basename = path.split("/").pop() ?? path;
    // Task 317: a snapshot reads the OWNING session's sidecar; its header title arrives with the bytes.
    if (node.classList.contains("n-snap")) {
        const sessionFile = node.dataset.sessionFile ?? "";
        const flashFile = sessionFile.split("/").pop() ?? sessionFile;
        return {
            params: new URLSearchParams({
                snapshotSession: sessionFile,
                sessionId: node.dataset.sessionId ?? "",
                version: node.dataset.version ?? "",
                path,
                dir: getInputById("dir").value.trim(),
            }),
            head: `${basename} Snapshot`,
            // 328.3: the header names the file ONCE; this row is provenance only.
            meta: `file-history @v${node.dataset.version ?? ""} of ${flashFile}`,
            flashFile,
        };
    }
    const hash = nodeCommitHash(node);
    if (hash === undefined) {
        return {
            params: new URLSearchParams({ dir: getInputById("dir").value.trim(), path }),
            head: `${basename} — Current on-disk state`,
            meta: "working tree",
        };
    }
    return {
        params: new URLSearchParams({ repo: getInputById("repo").value.trim(), path, hash }),
        head: `${basename} — at commit ${hash.slice(0, SHORT_HASH_LENGTH)}`,
        meta: `git show ${hash}`,
    };
}

// Task 323: the file's timeline IS the lane's DOM order; n-created has no bytes so cycling skips it.
function findAdjacentNode(offset: 1 | -1): HTMLElement | undefined {
    if (anchor === undefined) {
        return undefined;
    }
    const nodes = [...anchor.node.parentElement?.querySelectorAll(".node:not(.n-created)") ?? []] as HTMLElement[];
    return nodes[nodes.indexOf(anchor.node) + offset];
}

async function openNodeDrawer(node: HTMLElement, path: string): Promise<void> {
    // A plain click resets to a one-node selection (task 305) and anchors the next shift-click.
    clearDiffPair();
    anchor = { node, path };
    // Task 323: STOP at the timeline's ends — a missing neighbour disables that arrow, no wrap.
    for (const [id, offset] of [["dprev", -1], ["dnext", 1]] as const) {
        const arrow = getRequiredElementById(id) as HTMLButtonElement;
        arrow.hidden = false;
        arrow.disabled = findAdjacentNode(offset) === undefined;
    }
    const detail = describeNode(node, path);
    const header = getRequiredElementById("dpath");
    header.textContent = detail.head;
    header.title = path;
    getRequiredElementById("dmeta").textContent = detail.meta;
    // Clicking a node IS selecting it (user, 2026-07-26): the same highlight language a ruler-tick landing speaks.
    highlightLandedElement(node);
    getRequiredElementById("drawer").classList.add("open");
    // The drawer shrinks the pane, so re-centre against the POST-reflow layout (also why .drawer has no width transition).
    requestAnimationFrame(() => {
        node.scrollIntoView({ block: "nearest", inline: "center" });
        drawLayer1Minimap();
    });
    setDrawerTools(isImagePath(path) ? "img" : "none");
    // Task 299: an image renders as a picture straight off the binary route — no text fetch at all.
    if (isImagePath(path)) {
        getRequiredElementById("dmulti").hidden = true;
        detail.params.set("binary", "1");
        renderImageInto(getRequiredElementById("dbody"), `/api/layer1-file?${detail.params}`);
        return;
    }
    // Task 329: a node IS a DiffView with equal sides — the whole file, revision controls hidden.
    displayDetailView([buildDiffView(path, [describeNodeStep(node, path)], {
        revisionControlsShown: false,
        mode: DiffPaneMode.inline,
        fullContents: true,
        baseIndex: 0,
        targetIndex: 0,
    })]);
    // Task 317: a snapshot's header still carries the title in effect at its line; flash its JSONL.
    if (detail.flashFile !== undefined) {
        const response = await fetch(`/api/layer1-file?${detail.params}`);
        if (response.ok) {
            const payload = await response.json() as { title?: string };
            header.textContent = payload.title === undefined ? detail.head : `${detail.head} - ${payload.title}`;
        }
        flashSession(detail.flashFile);
    }
}

export function wireNodeDrawer(): void {
    wireImageZoomTools();
    getRequiredElementById("stage").addEventListener("click", (event) => {
        const node = findClickedNode(event.target as HTMLElement);
        // A created-at node is never the latest on-disk state, so it has no bytes to show.
        if (node === undefined || node.classList.contains("n-created")) {
            return;
        }
        const path = findNodePath(node);
        if (path === undefined) {
            return;
        }
        // Task 305: shift extends the anchored selection into a two-node diff pair.
        if ((event as MouseEvent).shiftKey && anchor !== undefined && getRequiredElementById("drawer").classList.contains("open")) {
            extendDiffSelection(anchor, node, path);
            return;
        }
        void openNodeDrawer(node, path);
    });
    // Task 323: cycling never leaves the lane, so the anchored path carries over.
    for (const [id, offset] of [["dprev", -1], ["dnext", 1]] as const) {
        getRequiredElementById(id).addEventListener("click", () => {
            const neighbour = findAdjacentNode(offset);
            if (neighbour !== undefined && anchor !== undefined) {
                void openNodeDrawer(neighbour, anchor.path);
            }
        });
    }
    getRequiredElementById("dclose").addEventListener("click", () => {
        getRequiredElementById("drawer").classList.remove("open");
        getRequiredElementById("dmulti").hidden = true;
        clearDiffPair();
        anchor = undefined;
        drawLayer1Minimap();
    });
}
