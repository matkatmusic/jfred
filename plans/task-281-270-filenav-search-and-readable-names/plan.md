# Tasks 281 + 270 — File Nav search box, and readable bubble file names

Two small, disjoint changes to the Layer 1 View. They share only the stylesheet.

## Task 281 — the File Nav's own search box

The nav pane (`webapp/layer1-filenav.ts`) renders every identified file through the webapp's shared
tree. It has no way to narrow that list; the only search box on the page is the find-bubble box,
which scrolls the timeline and is deliberately NOT reused here (task text).

1. `webapp/layer1.html` — inside `<aside class="filenav">`, between `.filenav-title` and
   `#filenav-tree`, add `<div class="filenav-search">` holding `<input id="filenav-search">`
   (placeholder `search files...`) and `<button id="filenav-search-clear">`.
2. `webapp/layer1-styles.css` — a `.filenav-search` rule beside the existing `.filenav` /
   `.filenav-title` rules, reusing `.sources input`'s exact font/padding/border/radius/focus values
   so the two boxes read as the same widget.
3. `webapp/layer1-filenav.ts` — `renderFileNavInto` gains an optional `query`, and filters
   `listFileNavEntries` by case-insensitive substring on the full path before `buildFileTree`.
   `renderLayer1FileNav` wires the box: `oninput` re-renders with the current text, the clear
   button empties the box and re-renders unfiltered.

   Property assignment (`oninput =`), not `addEventListener`: the page calls `renderLayer1FileNav`
   again on every load, and a second listener would keep the previous load's `view` alive.

   Substring, not fuzzy, and no debounce: ~800 short strings re-filter and re-render well inside a
   frame. No index, no scoring, no highlight.

4. `tests/layer1-filenav-search.test.ts` — typing a substring leaves only matching leaves; the
   clear button restores all of them.

Out of scope, deliberately: the search does not call `onFolderSelect`, so it never filters the
timeline and never disturbs task 253's folder selection. Re-rendering the tree does drop the
folders' expanded state — noted, not solved.

## Task 270 — bubble file names are truncated

`.fname` is one nowrap line ellipsised at the bubble's 168 px, so a 40-character name shows as
`971e94bac3cb2811…`. The `:hover` full reveal from task 280 already exists; the complaint is the
RESTING state.

Mechanism: let the basename WRAP to at most two lines (`white-space: normal` + `overflow-wrap:
anywhere` + a 2-line clamp), which fits ~40 characters at the current 168 px width — no wider
bubble, so the ~156,000 px canvas does not grow. `max-width` stays, so task 245's overprinting
cannot come back.

Two lines are taller than the header the bubble's `padding-top: 50px` was derived for, so that
derivation is redone in place: `.fname` gets an explicit 16 px line box (7 → 39), `.sub` moves from
`top: 24px` to `top: 43px` (43 → 58), and `padding-top` becomes 68 px (58 + the 10 px the first
node's ring reaches above the lane). The `:hover` reveal restores `nowrap` so it stays task 280's
single-line reveal rather than a wrapped block.

CSS only; no test.
