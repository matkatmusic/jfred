// Rule 3 of the visual assertions: bucket headings printed where a file path belongs.

import { BUCKET_TITLES, type StateGeometry } from "./geometry.ts";
import type { Violation } from "./violation-geometry.ts";

function isBucketTitle(text: string): boolean {
  const trimmed = text.trim();
  for (const title of BUCKET_TITLES) {
    if (title === trimmed) {
      return true;
    }
  }
  return false;
}

// Rule 3: bubble or tick-list entry showing a bucket heading instead of a file path (tasks 280/284).
export function findBucketTitleLabels(geometry: StateGeometry): Violation[] {
  const mislabelled: Violation[] = [];
  for (const name of geometry.fnames) {
    const hasBucketTitle = isBucketTitle(name.text);
    const isMislabelled = !name.isBucket && (hasBucketTitle || name.path === null);
    if (isMislabelled) {
      mislabelled.push({
        rule: "bucket-title-as-file-label",
        state: geometry.state,
        detail: `pair bubble prints "${name.text.trim()}" with data-path=${name.path ?? "(missing)"}`,
      });
    }
  }
  const inTickList: Violation[] = [];
  for (const button of geometry.tickFiles) {
    const hasBucketTitle = isBucketTitle(button.text);
    if (hasBucketTitle) {
      inTickList.push({
        rule: "bucket-title-in-tick-list",
        state: geometry.state,
        detail: `expanded ruler row lists "${button.text.trim()}" as though it were a file`,
      });
    }
  }
  return [...mislabelled, ...inTickList];
}
