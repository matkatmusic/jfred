// Task 257.5: the Detail View drawer; delegated on #stage since bubbles rebuild per render (wireLeaderVisibility's precedent).

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { renderFileContentInto } from "./layer1-file-view.ts";
import { isImagePath, renderImageInto, wireImageZoomTools } from "./layer1-drawer-image.ts";
import { clearDiffPair, extendDiffSelection, nodeCommitHash, setDrawerTools, wireDiffTools } from "./layer1-drawer-diff.ts";

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
function describeNode(node: HTMLElement, path: string): { params: URLSearchParams; head: string; meta: string } {
    const basename = path.split("/").pop() ?? path;
    const hash = nodeCommitHash(node);
    if (hash === undefined) {
        return {
            params: new URLSearchParams({ dir: getInputById("dir").value.trim(), path }),
            head: `${basename} — Current on-disk state`,
            meta: `${path}   ·   working tree`,
        };
    }
    return {
        params: new URLSearchParams({ repo: getInputById("repo").value.trim(), path, hash }),
        head: `${basename} — at commit ${hash.slice(0, SHORT_HASH_LENGTH)}`,
        meta: `${path}   ·   git show ${hash}:${path}`,
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
    (getRequiredElementById("dprev") as HTMLButtonElement).disabled = findAdjacentNode(-1) === undefined;
    (getRequiredElementById("dnext") as HTMLButtonElement).disabled = findAdjacentNode(1) === undefined;
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
    const body = getRequiredElementById("dbody");
    setDrawerTools(isImagePath(path) ? "img" : "none");
    // Task 299: an image renders as a picture straight off the binary route — no text fetch at all.
    if (isImagePath(path)) {
        detail.params.set("binary", "1");
        renderImageInto(body, `/api/layer1-file?${detail.params}`);
        return;
    }
    body.textContent = "loading…";
    const response = await fetch(`/api/layer1-file?${detail.params}`);
    // A refusal answers 400 with the message as the body — show it where the file would have been.
    if (!response.ok) {
        body.textContent = await response.text();
        return;
    }
    // `path` is what picks the highlighter's language (task 294).
    renderFileContentInto(body, (await response.json() as { content: string }).content, path);
}

export function wireNodeDrawer(): void {
    wireImageZoomTools();
    wireDiffTools();
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
            void extendDiffSelection(anchor, node, path);
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
        clearDiffPair();
        anchor = undefined;
        drawLayer1Minimap();
    });
}
