// Task 257.5: the Detail View drawer — clicking a node shows that file's bytes at that instant.
// Delegated on #stage and wired ONCE from bootLayer1Page: every bubble is rebuilt on each render,
// so per-node listeners would have to be re-attached every time (wireLeaderVisibility's precedent).

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { renderFileContentInto } from "./layer1-file-view.ts";

const SHORT_HASH_LENGTH = 8;

// The node a click landed on, or undefined for a click on anything else. The label opens the drawer
// too (mockup 755-772): the dot alone is a few pixels wide, and a node's label is its own name. A
// label's dot is its previous sibling — appendAxisNode appends the pair in that order.
function findClickedNode(target: HTMLElement): HTMLElement | undefined {
    const hit = target.closest(".node, .nlabel");
    const node = hit?.classList.contains("nlabel") === true ? hit.previousElementSibling : hit;
    // A bucket row has no dot, so a `.nlabel` there (or anywhere) resolves to a non-node sibling.
    return node?.classList.contains("node") === true ? node as HTMLElement : undefined;
}

// What the drawer asks for and says about one node. A commit node carries its full 40-char hash on
// `title` (buildPairWidget sets it); an on-disk node has none and reads the working tree instead.
function describeNode(node: HTMLElement, path: string): { params: URLSearchParams; head: string; meta: string } {
    const basename = path.split("/").pop() ?? path;
    const hash = node.classList.contains("n-commit") ? node.title : undefined;
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

async function openNodeDrawer(node: HTMLElement): Promise<void> {
    const nameElement = node.closest(".filebox")?.querySelector(".fname") as HTMLElement | null;
    const path = nameElement?.dataset.path;
    // Task 280 put the full path on the bubble's `.fname` data-path; without one there is no file
    // to fetch (a bucket row), so the click is not a drawer click.
    if (path === undefined) {
        return;
    }
    const detail = describeNode(node, path);
    const header = getRequiredElementById("dpath");
    header.textContent = detail.head;
    header.title = path;
    getRequiredElementById("dmeta").textContent = detail.meta;
    // Clicking a node to inspect it IS selecting it (user, 2026-07-26): the same highlight language
    // a ruler-tick landing speaks, so the reader never has to learn two.
    highlightLandedElement(node);
    getRequiredElementById("drawer").classList.add("open");
    // The drawer SHRINKS the timeline pane, so the node just clicked can end up behind the ruler or
    // off the edge. Re-centre against the POST-reflow layout, never the pre-open one — which is also
    // why .drawer carries no width transition.
    requestAnimationFrame(() => {
        node.scrollIntoView({ block: "nearest", inline: "center" });
        drawLayer1Minimap();
    });
    const body = getRequiredElementById("dbody");
    body.textContent = "loading…";
    const response = await fetch(`/api/layer1-file?${detail.params}`);
    // A refusal answers 400 with the message as the body — show it where the file would have been.
    if (!response.ok) {
        body.textContent = await response.text();
        return;
    }
    renderFileContentInto(body, (await response.json() as { content: string }).content);
}

export function wireNodeDrawer(): void {
    getRequiredElementById("stage").addEventListener("click", (event) => {
        const node = findClickedNode(event.target as HTMLElement);
        // Every n-commit node and every n-disk node opens the drawer: Layer 1 draws exactly ONE
        // on-disk node per pair, so the task's "only the LATEST disk node is clickable" caveat is
        // about a created-at node this layer does not draw — there is nothing to gate here yet.
        if (node === undefined) {
            return;
        }
        void openNodeDrawer(node);
    });
    getRequiredElementById("dclose").addEventListener("click", () => {
        getRequiredElementById("drawer").classList.remove("open");
        drawLayer1Minimap();
    });
}
