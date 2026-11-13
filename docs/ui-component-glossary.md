# Layer 1 UI Component Glossary

When you name a UI part, use the **Canonical** name (or an alias listed here). Each row
gives the owning module, its DOM id / CSS class, and one line on what it is. Layer 1 page
= `layer1.html`; top container `div#appWindow`; the box tree is built by `buildLayer1Layout()`
in `webapp/layer1-layout.ts`; boot/wire module `layer1-page.ts`. A built box has
id = class = `data-component` = its camelCase name. Component files live under
`webapp/layer1-components/<folder>/`.

Box tree, exactly as `buildLayer1Layout()` builds it today:

```text
div#appWindow
├── headerContainer
│   ├── headerRowComponent
│   │   ├── h1
│   │   ├── #crumb
│   │   ├── .timebar
│   │   ├── #project-settings
│   │   ├── #commit-mode
│   │   ├── #clear-results
│   │   ├── names toggle [data-component-inspector-toggle]
│   │   ├── #clear-results-confirm
│   │   ├── .zoombar
│   │   └── .layerbar
│   ├── .sources:not(.repo)
│   ├── .sources.repo
│   ├── jumpToRowComponent
│   └── #engine-v3-bar
└── sessionDataContainer
    ├── sourcesContainer
    │   ├── fileNavComponent
    │   ├── #navpane-grip
    │   └── jsonlsComponent
    ├── #filenav-grip
    └── timelineComponentsContainer
        ├── #loadbar
        ├── timelineViewControls
        │   └── #session-toggle (last child)
        └── timelineContainer
            └── .canvas
                ├── #leaders
                ├── #washes
                ├── #ranges
                ├── timelineRulerContainer
                │   ├── minimapComponent (position: fixed)
                │   ├── timelineRulerComponent
                │   ├── sessionDotLinesComponent (added when shown)
                │   └── jfredCommitsDrawerComponent (added when shown)
                └── fileBubbleContainer
                    └── detailsPaneContainer
```

The minimap is the first child of `timelineRulerContainer`. It uses `position: fixed`, and code puts it at the right edge of the ruler-side overlays. The details pane is inside `fileBubbleContainer`.

| Your name(s) | Canonical | Module | DOM id / CSS class | What it is |
|---|---|---|---|---|
| page, app, window, viz root, appWindow | App window | layer1-layout.ts, layer1-page.ts | `div#appWindow` (`.appWindow`) | Top container of the Layer 1 page; holds `headerContainer` and `sessionDataContainer` |
| header, top bar, headerContainer | Header container | layer1-layout.ts | `#headerContainer` (`.headerContainer`) | Rows box above the session data: header row, source rows, jump-to row, engine bar (last child) |
| header row, title row, headerRowComponent | Header row | layer1-layout.ts (box), top-bars/top-bars.html (parts) | `#headerRowComponent` (`.headerRowComponent`) | One row holding h1, `#crumb`, `.timebar`, `#project-settings`, `#commit-mode`, `#clear-results`, the names toggle, `#clear-results-confirm`, `.zoombar`, `.layerbar` |
| session data, stage wrap, sessionDataContainer | Session data container | layer1-layout.ts | `#sessionDataContainer` (`.sessionDataContainer`) | Columns box under the header: sources, grip, timeline components |
| left aside, nav aside, sources, sourcesContainer | Sources container | layer1-layout.ts | `#sourcesContainer` (`.sourcesContainer`) | Rows box on the left holding File Nav and the JSONLs pane |
| fileNav, JSONL nav, file nav, fileNavComponent | File Nav pane | file-nav/layer1-filenav.ts | `#fileNavComponent` (`.navpane`); tree `#filenav-tree`; search `#filenav-search`; "Show Only Selected" `#filenav-only-selected` | Left pane listing every identified file/folder |
| pane grips, resize handle | File Nav resize grips | file-nav/layer1-filenav-resize.ts | `#filenav-grip` (`.filenav-grip`), `#navpane-grip` (`.pane-grip`) | Drags: outer resizes the sources container width, inner re-shares pane heights. `#navpane-grip` sits inside `sourcesContainer`, between `fileNavComponent` and `jsonlsComponent` |
| JSONLs pane, sessions list, jsonlsComponent | JSONLs pane | jsonls-nav/layer1-sessions.ts | `#jsonlsComponent` (`.navpane`); list `#sessions`; clear `#clear-sessions` | Lower nav pane of project JSONL sessions; click filters timeline |
| source boxes, source pickers | JSONL source pickers (modal) | popups/layer1-path-picker.ts, top-bars/layer1-source-paths.ts, top-bars/layer1-sources.ts | modal `#pathpicker` (`.modal-wrap`); triggers `#pick-jsonl`, `#pick-fh`; rows `#pp-list` | One dialog editing both source-folder lists (JSONL + file-history) |
| timeline parts, timelineComponentsContainer | Timeline components container | layer1-layout.ts | `#timelineComponentsContainer` (`.timelineComponentsContainer`) | Rows box holding `#loadbar`, `timelineViewControls`, `timelineContainer` |
| show row, kind checkboxes, timelineViewControls | Timeline view controls | show-row/layer1-show-row.ts, show-row/layer1-kind-filter.ts, show-row/layer1-kind-jump.ts | `#timelineViewControls` (`.timelineViewControls`); kind boxes `input[data-kind]`; session button `#session-toggle` (`<button>` in show-row.html) | Row of kind checkboxes and jump buttons that hide or show node kinds; the last child is the session button, hidden when the view has no annotations |
| timeline, scroll box, timelineContainer | Timeline container | layer1-layout.ts | `#timelineContainer` (`.timelineContainer`); only child `.canvas` | The one scroll box of the timeline |
| stage, canvas, bubble column box, fileBubbleContainer | Timeline stage | layer1-page.ts (host), layer1-widgets.ts (contents), bubbles/layer1-stage-render.ts | `#fileBubbleContainer` (`.fileBubbleContainer`) in `#timelineContainer > .canvas` | Main horizontal canvas of per-file bubble columns |
| bubbles, file columns | Bubbles | layer1-widgets.ts | `.filebox` (orphan `.filebox.bucket`); name `.fname`, sub `.sub` | One column per file / orphan bucket |
| lanes | Lanes | layer1-widgets.ts | `.lane` (rail `.lrail`, same-timestamp group `.nodes-with-same-timestamp`) | Vertical time-lane inside each bubble |
| nodes, dots, markers | Nodes | layer1-widgets.ts | `.node` / `.nlabel` (`.n-commit`, `.n-disk`, `.n-snap`, `.n-created`) | Revision markers + labels on a lane |
| ruler column, sticky ruler box, timelineRulerContainer | Timeline ruler container | layer1-layout.ts | `#timelineRulerContainer` (`.timelineRulerContainer`) in `.canvas` | Sticky box holding the minimap (fixed), the ruler, then the session dot lines, then the commits drawer. Its negative right margin keeps the bubbles in place, so the lines and the drawer lie over them |
| ruler, gutter, ticks, timelineRulerComponent | Ruler / gutter | ruler/layer1-ruler-axis.ts, ruler/layer1-ruler-rows.ts, ruler/layer1-ruler-click.ts, ruler/layer1-tick-files.ts | `#timelineRulerComponent` (`.timelineRulerComponent`, sticky); rail `.rail`; ticks `.tick` (`.inrange/.multi/.expanded`) | Left sticky time ruler with tick marks/labels |
| session dots, session dot lines, annotation track, sessionDotLinesComponent | Session dot lines | session-column/layer1-annotation-track.ts, session-column/layer1-annotation-dots.ts | `#sessionDotLinesComponent` (`.sessionDotLinesComponent`); head `.ahead`; dots `.anode` | Overlay column of session dots (position: relative), added into `timelineRulerContainer` when `#session-toggle` turns it on; it lies over the bubbles |
| leaders, leader lines | Leaders | bubbles/layer1-leader-hover.ts, bubbles/layer1-leader-visibility.ts | `#leaders` (`.leaders`); each `.leader` (`.shown`, `.aimed`) | Horizontal lines aligning ruler ticks to bubbles on hover/find |
| minimap, minimapComponent | Minimap | minimap/layer1-minimap.ts, minimap/layer1-minimap-position.ts | `#minimapComponent` (`.minimapComponent`); plot `#mm-plot` (`.mm-plot`); viewport `#mm-view` (`.mm-view`); marks `.mm-box` | Overview of the whole canvas with a draggable viewport, placed by code at the right edge of the ruler, session dot lines or commits drawer |
| session wash, jsonl wash, session range bar | Session range bar + wash | bubbles/layer1-wash.ts (`spawnWash`→`.wash`), bubbles/layer1-ranges.ts | washes in `#washes` (`.washes`, behind bubbles); range bars in `#ranges` (`.ranges`) | Wash = translucent band over a file's session-answerable stretch; range bar = thin marker in left lane |
| diff wash | Diff wash | bubbles/layer1-diff-wash.ts | reuses `.wash` in `#washes`; ruler labels `.wash-edge.base` / `.wash-edge.target` | Band between the two revisions of an open diff selection |
| nav wash, file nav wash, selection wash | File Nav wash | file-nav/layer1-nav-wash.ts | reuses `.wash` in `#washes`; own marker `.nav-wash` | Band spanning the oldest→newest drawn event across the files currently selected in File Nav |
| DetailView, Diff View, drawer, diff viewer, details pane, detailsPaneContainer | Detail View drawer | details-drawer/layer1-drawer.ts, details-drawer/layer1-drawer-diff.ts, details-drawer/layer1-drawer-multi.ts, details-drawer/layer1-details-pane.ts | `aside#detailsPaneContainer` (`.detailsPaneContainer`, `.open`); grip `#details-pane-grip`; header `.dhead` (`#dpath`, tools `.dtools`, `#dclose`); body `#dbody` | Overlay inside fileBubbleContainer, pinned to the right edge of timelineContainer; shows the file's bytes/diff at the clicked node; its left-edge grip sets the width, 30 to 50 percent of the visible bubble width; it gets narrower when the session dot lines or the commits drawer go on |
| git header row, diff viewer row #3, DiffView sections | DiffView sections / header rows | details-drawer/layer1-diff-view.ts | per-file `<details>.dfile`; header `.dhead.dfile-head` (`.dpath.dfile-path`); pair label `.dpair`; arrows `.dtools`; full-content `.dfull-toggle` | Drawer's per-file header rows + one collapsible section per file |
| diff pane, diff rows | Diff pane | details-drawer/layer1-diff-pane.ts, diff-render.ts | mounts into `#dbody`; binary notice `.dbinary`; toast `#dtoast` (`.dtoast`) | Renders side/inline diff for a step pair |
| find box, search box, jump-to row, jumpToRowComponent | Find box | top-bars/layer1-find-file.ts | input `#find-file`; `#find-prev`/`#find-next`; readout `#find-status`; in `#jumpToRowComponent` | Searches bubble names, cycles matches, scrolls to the bubble |
| layer switcher, layer buttons | Layer switcher | top-bars/layer1-layer-toggle.ts | none (markup commented out) | RETIRED by task 352: the markup is commented out, pending the task 360 show row. Snapshot nodes now always show |
| zoom | Zoom bar | top-bars/layer1-zoom.ts | `.zoombar` in `#headerRowComponent` | Zoom control for the stage |
| time toggle, committer/author | Time toggle | top-bars/layer1-time-toggle.ts | `.timebar` in `#headerRowComponent` | Toggles committer vs author time |
| jump buttons | Jump-to-bucket | top-bars/layer1-jump-buckets.ts | `#jumpToRowComponent button[data-bucket]` | Scrolls timeline to a named bucket |
| load bar, progress bar | Load progress bar | loading-bar/layer1-progress.ts | `#loadbar` in `#timelineComponentsContainer` | Load progress indicator |
| branch picker, commit picker, branch dropdown | Branch picker | layer1-refs.ts (markup in top-bars/top-bars.html) | branch `#branch`, commit `#commit` (in `label.repo-only`); hidden until `.repo-ok` is set on `.sources.repo` | Dropdowns that write into `#ref` |
| commits column, jfred strip, commits drawer, commit mode, jfredCommitsDrawerComponent | Commits column / Commit mode | commits-column/layer1-jfred-strip.ts, commits-column/layer1-cut-marks.ts | drawer `#jfredCommitsDrawerComponent` (`.jfredCommitsDrawerComponent`, added into `timelineRulerContainer` when shown, position: relative, lies over the bubbles); button `#commit-mode`; nodes `.jnode`; chains `.jchain`; Yes/No row `#yesno-row` (popups/layer1-yes-no-row.ts) | Drawer of jfred commit nodes beside the timeline, plus the button that arms commit mode |
