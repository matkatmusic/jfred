// The Layer 1 page's three header source boxes (?dir=&repo=&ref=) and their folder pickers. Split out of layer1-page.ts, which sat exactly at the ~250-line ceiling its neighbours hold while several more Layer 1 features still had to wire into its boot (tasks 246, 256, 260, 261) — the same reason layer1-progress.ts and layer1-zoom.ts were split out before it. Nothing here draws: this module only reads, seeds and picks into the boxes.

import { getInputById, getRequiredElementById } from "./app-dom.ts";

// The three header boxes; the ids match layer1.html and the names match the endpoint's params.
const SOURCE_PARAM_IDS = ["dir", "repo", "ref"] as const;

// Which git stamp places a bubble (task 282). These bare strings mirror `CommitTimeSource` in src/structures/vocabulary.ts, re-spelled because webapp/ cannot import from src/ — the same constraint that re-declares `Instant` atop layer1-ruler-axis.ts.
export const TIME_SOURCE_VALUES = ["committer", "author"] as const;
let selectedTimeSource: string = TIME_SOURCE_VALUES[0];

export function readTimeSource(): string {
    return selectedTimeSource;
}

export function selectTimeSource(value: string): void {
    selectedTimeSource = value;
}

// The header boxes as endpoint/URL params. A blank box contributes nothing: the ref box is optional and the endpoint reads an absent ref as the repo's active branch.
export function readSourceParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const id of SOURCE_PARAM_IDS) {
        const value = getInputById(id).value.trim();
        if (value !== "") {
            params.set(id, value);
        }
    }
    // Only the non-default reading is written, so a default view's URL — and every link already shared — stays exactly as it was.
    if (selectedTimeSource !== TIME_SOURCE_VALUES[0]) {
        params.set("time", selectedTimeSource);
    }
    return params;
}

// Seed the boxes from the page URL so ?dir=&repo=&ref= is a working shareable link.
export function fillSourceBoxesFromUrl(): void {
    const params = new URLSearchParams(location.search);
    for (const id of SOURCE_PARAM_IDS) {
        const value = params.get(id);
        if (value !== null) {
            getInputById(id).value = value;
        }
    }
    // An unknown ?time= is ignored rather than trusted: it would otherwise reach the endpoint as a stamp name no git command understands.
    const time = params.get("time");
    if (time !== null && TIME_SOURCE_VALUES.some((value) => value === time)) {
        selectTimeSource(time);
    }
}

// GET /api/pick-folder (task 236) — an empty path means the user cancelled, so leave the box alone. ponytail: a local 5-liner rather than app-header.ts's pickFolderInto, which drags in app-router → views/timeline → the whole classic app and reports failures into that page's #breadcrumb; lift it into a shared module if a third page ever needs a picker.
async function pickFolderInto(target: HTMLInputElement): Promise<void> {
    const response = await fetch(`/api/pick-folder?current=${encodeURIComponent(target.value)}`);
    if (!response.ok) {
        getRequiredElementById("crumb").textContent = `folder picker failed: ${await response.text()}`;
        return;
    }
    const { path } = await response.json() as { path: string };
    if (path !== "") {
        target.value = path;
    }
}

// Wire each `button.pick` to the box named by its `data-for`, re-drawing once a pick lands.  `afterPick` is passed in rather than imported: the only caller is layer1-page.ts's boot, and reaching back for its loadLayer1View would make the two modules circular.
export function wireFolderPickers(afterPick: () => void): void {
    for (const button of document.querySelectorAll("button.pick")) {
        const target = getInputById((button as HTMLElement).dataset.for ?? "");
        button.addEventListener("click", () => {
            void pickFolderInto(target).then(afterPick);
        });
    }
}
