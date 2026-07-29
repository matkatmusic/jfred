// The Layer 1 header's committer/author toggle (task 282). Two commits rewritten in one rebase share a committer instant while their author instants are days apart, so which stamp places a bubble is chosen per view. The instants are resolved server-side, so a flip re-loads the view.

import { getRequiredElementById } from "./app-dom.ts";
import { TIME_SOURCE_VALUES, readTimeSource, selectTimeSource } from "./layer1-sources.ts";

// The button ids are `time-<value>`, so the suffix IS the value — a lookup, not a translation.
function findTimeSourceButton(value: string): HTMLElement {
    return getRequiredElementById(`time-${value}`);
}

function markSelectedTimeSource(): void {
    for (const value of TIME_SOURCE_VALUES) {
        findTimeSourceButton(value).classList.toggle("current", value === readTimeSource());
    }
}

// Wire both buttons, and sync `.current` to whatever fillSourceBoxesFromUrl already seeded, so boot needs one call and not two. `afterChange` is passed in rather than imported, exactly as wireFolderPickers does it: reaching back for loadLayer1View would make the modules circular.
export function wireTimeSourceToggle(afterChange: () => void): void {
    for (const value of TIME_SOURCE_VALUES) {
        findTimeSourceButton(value).addEventListener("click", () => {
            selectTimeSource(value);
            markSelectedTimeSource();
            afterChange();
        });
    }
    markSelectedTimeSource();
}
