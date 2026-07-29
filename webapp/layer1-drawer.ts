// Task 257.5: the Detail View drawer; delegated on #stage since bubbles rebuild per render (wireLeaderVisibility's precedent).

import { getInputById, getRequiredElementById } from "./app-dom.ts";
import { highlightLandedElement } from "./layer1-find-file.ts";
import { drawLayer1Minimap } from "./layer1-minimap.ts";
import { renderFileContentInto } from "./layer1-file-view.ts";
import { isImagePath, renderImageInto, wireImageZoomTools } from "./layer1-drawer-image.ts";

const SHORT_HASH_LENGTH = 8;

// The clicked node, or undefined; a label opens too, and its dot is its previous sibling (appendAxisNode's order).
function findClickedNode(target: HTMLElement): HTMLElement | undefined {
    const hit = target.closest(".node, .nlabel");
    const node = hit?.classList.contains("nlabel") === true ? hit.previousElementSibling : hit;
    // A bucket row has no dot, so a `.nlabel` there (or anywhere) resolves to a non-node sibling.
    return node?.classList.contains("node") === true ? node as HTMLElement : undefined;
}

// A commit node carries its full hash on the dot's `title`; an on-disk node has none.
//
// An empty title means "no commit" — a blank `hash=` would 400 naming the wrong parameter.
function describeNode(node: HTMLElement, path: string): { params: URLSearchParams; head: string; meta: string } {
    const basename = path.split("/").pop() ?? path;
    const hash = node.classList.contains("n-commit") && node.title !== "" ? node.title : undefined;
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
    // Task 280: the full path lives on `.fname` data-path; without one (a bucket row) there is nothing to fetch.
    if (path === undefined) {
        return;
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

// ONE control strip (tasks 299/305): the header shows the tools for what the body holds.
export function setDrawerTools(tools: "img" | "diff" | "none"): void {
    getRequiredElementById("imgtools").hidden = tools !== "img";
    document.getElementById("difftools")?.toggleAttribute("hidden", tools !== "diff");
}

export function wireNodeDrawer(): void {
    wireImageZoomTools();
    getRequiredElementById("stage").addEventListener("click", (event) => {
        const node = findClickedNode(event.target as HTMLElement);
        // A created-at node is never the latest on-disk state, so it has no bytes to show.
        if (node === undefined || node.classList.contains("n-created")) {
            return;
        }
        void openNodeDrawer(node);
    });
    getRequiredElementById("dclose").addEventListener("click", () => {
        getRequiredElementById("drawer").classList.remove("open");
        drawLayer1Minimap();
    });
}
