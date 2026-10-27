// The shared diff display-mode vocabulary and its stored-value resolution. Pure — no DOM.

// Which layout every diff pane uses. Module-level so the choice sticks across re-renders, and mirrored to localStorage so it survives reloads (item 10f).
export const DiffDisplayMode = Object.freeze({ split: "split", inline: "inline" } as const);
export type DiffDisplayModeValue = (typeof DiffDisplayMode)[keyof typeof DiffDisplayMode];
// Exported (item 66): the Details pane's Columns/Inline toggle persists through the SAME key and value vocabulary, so both diff surfaces share one remembered preference.
export const DIFF_MODE_STORAGE_KEY = "diffDisplayMode";

// A stored value resolves to a mode: only the exact "inline" wire string opts out of the split default (null / garbage / absent all mean split).
export function computeInitialDiffDisplayMode(storedValue: string | null | undefined): DiffDisplayModeValue {
  if (storedValue === DiffDisplayMode.inline) {
    return DiffDisplayMode.inline;
  }
  return DiffDisplayMode.split;
}
