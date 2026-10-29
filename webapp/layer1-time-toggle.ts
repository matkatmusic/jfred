// The Layer 1 header committer/author toggle (task 282); a flip re-loads the view.

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

// Wire both buttons and sync `.current` to the seeded value; `afterChange` is passed in to avoid a cycle.
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
