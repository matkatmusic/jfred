// The shared diff display-mode vocabulary and its stored-value resolution.

// Which layout every diff pane uses; mirrored to localStorage (item 10f).
export const DiffDisplayMode = Object.freeze({ split: "split", inline: "inline" } as const);
export type DiffDisplayModeValue = (typeof DiffDisplayMode)[keyof typeof DiffDisplayMode];
// The Details pane toggle uses this same key and values (item 66).
export const DIFF_MODE_STORAGE_KEY = "diffDisplayMode";

// Only the exact "inline" string selects inline; null, garbage and absent all mean split.
export function computeInitialDiffDisplayMode(storedValue: string | null | undefined): DiffDisplayModeValue {
  if (storedValue === DiffDisplayMode.inline) {
    return DiffDisplayMode.inline;
  }
  return DiffDisplayMode.split;
}
