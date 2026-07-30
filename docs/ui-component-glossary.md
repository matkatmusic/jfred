# Layer 1 UI Component Glossary

When you name a UI part, use the **Canonical** name (or an alias listed here). Each row
gives the owning module, its DOM id / CSS class, and one line on what it is. Layer 1 page
= `layer1.html`; top container `div.viz-root[data-layer="1"]`; boot/wire module
`layer1-page.ts`.

| Your name(s) | Canonical | Module | DOM id / CSS class | What it is |
|---|---|---|---|---|
| fileNav, JSONL nav, file nav | File Nav pane | layer1-filenav.ts | `#pane-files` / `.navpane` in `aside.filenav`; tree `#filenav-tree`; search `#filenav-search`; "Show Only Selected" `#filenav-only-selected` | Left pane listing every identified file/folder |
| pane grips, resize handle | File Nav resize grips | layer1-filenav-resize.ts | `#filenav-grip` (`.filenav-grip`), `#navpane-grip` (`.pane-grip`) | Drags: outer resizes aside width, inner re-shares pane heights |
| JSONLs pane, sessions list | JSONLs pane | layer1-sessions.ts | `#pane-sessions` (`.navpane`); list `#sessions`; clear `#clear-sessions` | Lower nav pane of project JSONL sessions; click filters timeline |
| source boxes, source pickers | JSONL source pickers (modal) | layer1-path-picker.ts, layer1-source-paths.ts, layer1-sources.ts | modal `#pathpicker` (`.modal-wrap`); triggers `#pick-jsonl`, `#pick-fh`; rows `#pp-list` | One dialog editing both source-folder lists (JSONL + file-history) |
| timeline, stage, canvas | Timeline stage | layer1-page.ts (host), layer1-widgets.ts (contents) | `#stage` (`.stage`) in `main#timelines > .canvas`, wrapped by `#stagewrap` | Main horizontal canvas of per-file bubble columns |
| bubbles, file columns | Bubbles | layer1-widgets.ts | `.filebox` (orphan `.filebox.bucket`); name `.fname`, sub `.sub` | One column per file / orphan bucket |
| lanes | Lanes | layer1-widgets.ts | `.lane` (rail `.lrail`, tie group `.tiegroup`) | Vertical time-lane inside each bubble |
| nodes, dots, markers | Nodes | layer1-widgets.ts | `.node` / `.nlabel` (`.n-commit`, `.n-disk`, `.n-snap`, `.n-created`) | Revision markers + labels on a lane |
| ruler, gutter, ticks | Ruler / gutter | layer1-ruler-axis.ts, layer1-ruler-rows.ts, layer1-ruler-click.ts, layer1-tick-files.ts | `#ruler` (`.ruler`, sticky); rail `.ruler .rail`; ticks `.tick` (`.inrange/.multi/.expanded`) | Left sticky time ruler with tick marks/labels |
| leaders, leader lines | Leaders | layer1-leader-hover.ts, layer1-leader-visibility.ts | `#leaders` (`.leaders`); each `.leader` (`.shown`, `.aimed`) | Horizontal lines aligning ruler ticks to bubbles on hover/find |
| minimap | Minimap | layer1-minimap.ts | `.minimap`; plot `#mm-plot` (`.mm-plot`); viewport `#mm-view` (`.mm-view`); marks `.mm-box` | Lower-left overview of the whole canvas with a draggable viewport |
| session wash, jsonl wash, session range bar | Session range bar + wash | layer1-wash.ts (`spawnWash`→`.wash`), layer1-ranges.ts | washes in `#washes` (`.washes`, behind bubbles); range bars in `#ranges` (`.ranges`) | Wash = translucent band over a file's session-answerable stretch; range bar = thin marker in left lane |
| diff wash | Diff wash | layer1-diff-wash.ts | reuses `.wash` in `#washes`; ruler labels `.wash-edge.base` / `.wash-edge.target` | Band between the two revisions of an open diff selection |
| DetailView, Diff View, drawer, diff viewer | Detail View drawer | layer1-drawer.ts, layer1-drawer-diff.ts, layer1-drawer-multi.ts | `aside#drawer` (`.drawer`, `.open`); header `.dhead` (`#dpath`, tools `.dtools`, `#dclose`); body `#dbody` | Third flex pane; shows the file's bytes/diff at the clicked node |
| git header row, diff viewer row #3, DiffView sections | DiffView sections / header rows | layer1-diff-view.ts | per-file `<details>.dfile`; header `.dhead.dfile-head` (`.dpath.dfile-path`); pair label `.dpair`; arrows `.dtools`; full-content `.dfull-toggle` | Drawer's per-file header rows + one collapsible section per file |
| diff pane, diff rows | Diff pane | layer1-diff-pane.ts, diff-render.ts | mounts into `#dbody`; binary notice `.dbinary`; toast `#dtoast` (`.dtoast`) | Renders side/inline diff for a step pair |
| find box, search box | Find box | layer1-find-file.ts | input `#find-file`; `#find-prev`/`#find-next`; readout `#find-status`; in `.jumpbar` | Searches bubble names, cycles matches, scrolls to the bubble |
| layer switcher, layer buttons | Layer switcher | layer1-layer-toggle.ts | `.layerbar button[data-layer]` (`.current` = active) | Switches Layer 1 ↔ Layer 2 (Layer 2 adds file-history snapshots) |
| zoom | Zoom bar | layer1-zoom.ts | `.zoombar` | Zoom control for the stage |
| time toggle, committer/author | Time toggle | layer1-time-toggle.ts | `.timebar` | Toggles committer vs author time |
| jump buttons | Jump-to-bucket | layer1-jump-buckets.ts | `.jumpbar button[data-bucket]` | Scrolls timeline to a named bucket |
| load bar, progress bar | Load progress bar | layer1-progress.ts | `#loadbar` | Load progress indicator |
