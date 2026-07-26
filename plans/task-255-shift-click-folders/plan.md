# Task 255 — shift-click folders in the Layer 1 File Nav to select more than one

## What already works

- `attachFolderClick` (`webapp/views/sidebar.ts`) reports one folder's files per click.
- `listDescendantTargets(node)` already walks nested subfolders, so "including nested
  subfolders" is satisfied per folder — nothing to add there.
- `filterLayer1ViewByTargets` (`webapp/layer1-filter.ts`) already accepts an arbitrary path
  list and re-runs the ruler layout over the survivors, so a UNION needs no change outside
  `sidebar.ts`. The task-253 timeline range resize therefore applies to the union for free.

## The change (one file)

`webapp/views/sidebar.ts`:

1. Name the folder-row class once (`FOLDER_NAME_CLASS`) — it is now read back by a query as
   well as written by the renderer.
2. Module-level `WeakMap<HTMLElement, string[]>` keyed by the folder `<summary>`, filled at
   attach time with `listDescendantTargets(node)`. The list is static per folder, so no
   selection state object is needed — the DOM's `selected` class stays the only state, as it
   already was in task 253.
3. In the click handler: skip `clearFileSelectionIn` when `event.shiftKey`, toggle only this
   summary's class either way, and report the de-duplicated union of every currently-selected
   folder summary inside `selectionRoot` (a selected parent and a selected child overlap).
4. Plain click is unchanged by construction: after the clear, this summary is the only selected
   folder, so the union is exactly today's `listDescendantTargets(node)`, and a re-click on the
   selected folder leaves nothing selected, so the union is `[]`.

Preserved: the `.file-folder-toggle` early return, and no `preventDefault`/`stopPropagation`
(expanding the `<details>` is the click's default action).

## Check

`tests/sidebar-folder-multiselect.test.ts` (node --test + happy-dom, rendered through
`renderFileNavInto` with a spy, matching `tests/layer1-folder-filter.test.ts`):

- shift-clicking a second folder reports the union of both folders' targets and leaves BOTH
  rows marked selected;
- a plain click after that still replaces the selection with one folder;
- shift-clicking a selected folder again removes just it from the union.

## Out of scope

Keyboard/ctrl-click, a "clear all" affordance, persisting the multi-selection across renders.
