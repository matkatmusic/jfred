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
| ruler column, sticky ruler box, timelineRulerContainer | Timeline ruler container | layer1-layout.ts | `#timelineRulerContainer` (`.timelineRulerContainer`) in `.canvas` | Sticky box holding the minimap (fixed), the ruler, then the session dot lines, then the commits drawer. It grows when they are shown and pushes fileBubbleContainer, which always starts at its right edge |
| ruler, gutter, ticks, timelineRulerComponent | Ruler / gutter | ruler/layer1-ruler-axis.ts, ruler/layer1-ruler-rows.ts, ruler/layer1-ruler-click.ts, ruler/layer1-tick-files.ts | `#timelineRulerComponent` (`.timelineRulerComponent`, sticky); rail `.rail`; ticks `.tick` (`.inrange/.multi/.expanded`) | Left sticky time ruler with tick marks/labels |
| session dots, session dot lines, annotation track, sessionDotLinesComponent | Session dot lines | session-column/layer1-annotation-track.ts, session-column/layer1-annotation-dots.ts | `#sessionDotLinesComponent` (`.sessionDotLinesComponent`); head `.ahead`; dots `.anode` | Column of session dots (position: relative), added into `timelineRulerContainer` when `#session-toggle` turns it on; it pushes the bubbles right |
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
| commits column, jfred strip, commits drawer, commit mode, jfredCommitsDrawerComponent | Commits column / Commit mode | commits-column/layer1-jfred-strip.ts, commits-column/layer1-cut-marks.ts | drawer `#jfredCommitsDrawerComponent` (`.jfredCommitsDrawerComponent`, added into `timelineRulerContainer` when shown, position: relative, pushes the bubbles right); button `#commit-mode`; nodes `.jnode`; chains `.jchain`; Yes/No row `#yesno-row` (popups/layer1-yes-no-row.ts) | Drawer of jfred commit nodes beside the timeline, plus the button that arms commit mode. In Bars view the pinned strip (bars-view/layer1-bars-cut-strip.ts) takes the place of the column |
| Bars view, bars, ProjectLifetimeBar rows | Bars view | bars-view/layer1-bars-view.ts | `#barsViewComponent` in `.canvas`; slider `#barsViewSliderInput` in `#jumpToRowComponent`; mode class `barsViewOn` on `#appWindow` | One bar per file with change history chunks and event dots; the default view, the slider moves to Bubbles |

## Every data-component name

Turn the "names" button on, then hover any part of the page to see its name here. Copy gives the file and line.
A test (tests/glossary-matches-page.test.ts) fails when a page part has no row in this section.

### Header row

| Name | File | What you see |
|---|---|---|
| headerPageTitle | layer1-components/top-bars/top-bars.html | Big title "Layer 1 View" |
| headerCrumbReadout | layer1-components/top-bars/top-bars.html | Small count text beside the title |
| headerTimeToggle | layer1-components/top-bars/top-bars.html | The "Time:" box with the two buttons |
| headerTimeCommitterButton | layer1-components/top-bars/top-bars.html | "committer" button |
| headerTimeAuthorButton | layer1-components/top-bars/top-bars.html | "author" button |
| headerProjectSettingsButton | layer1-components/top-bars/top-bars.html | "project settings" button |
| headerClearResultsButton | layer1-components/top-bars/top-bars.html | "Clear saved results" button |
| headerNamesToggleButton | layer1-components/top-bars/top-bars.html | "names" button |
| headerClearResultsConfirmText | layer1-components/top-bars/top-bars.html | Question "Clear all saved results and compute everything again?" |
| headerClearResultsYesButton | layer1-components/top-bars/top-bars.html | "Yes, clear" button |
| headerClearResultsNoButton | layer1-components/top-bars/top-bars.html | "No" button next to "Yes, clear" |
| headerZoomBar | layer1-components/top-bars/top-bars.html | The "Zoom:" box with four controls |
| headerZoomOutButton | layer1-components/top-bars/top-bars.html | "−" button |
| headerZoomLevelReadout | layer1-components/top-bars/top-bars.html | Zoom number, for example "100%" |
| headerZoomInButton | layer1-components/top-bars/top-bars.html | "+" button |
| headerZoomResetButton | layer1-components/top-bars/top-bars.html | "Reset" button |
| headerLayer3Button | layer1-components/top-bars/top-bars.html | Round button "3" |
| headerLayer4Button | layer1-components/top-bars/top-bars.html | Round button "4" |
| headerProjectFolderLabel | layer1-components/top-bars/top-bars.html | The "Project folder" label with its box and button |
| headerProjectFolderInput | layer1-components/top-bars/top-bars.html | Text box for the project folder |
| headerProjectFolderOpenButton | layer1-components/top-bars/top-bars.html | "Open…" button by the project folder |
| headerJsonlSourcesButton | layer1-components/top-bars/top-bars.html | "JSONL sources" button |
| headerFileHistorySnapshotsButton | layer1-components/top-bars/top-bars.html | "File History Snapshots" button |
| headerSaveProjectSettingsButton | layer1-components/top-bars/top-bars.html | "Save project settings" button |
| headerSavedNoteText | layer1-components/top-bars/top-bars.html | Small "saved" note after saving |
| headerGitRepoLabel | layer1-components/top-bars/top-bars.html | The "Git repo" label with its box and button |
| headerGitRepoInput | layer1-components/top-bars/top-bars.html | Text box for the git repo folder |
| headerGitRepoOpenButton | layer1-components/top-bars/top-bars.html | "Open…" button by the git repo |
| headerGitRepoFlagText | layer1-components/top-bars/top-bars.html | Green "✓ git repo" flag |
| headerBranchPicker | layer1-components/top-bars/top-bars.html | The "Branch" label with its list |
| headerBranchSelect | layer1-components/top-bars/top-bars.html | Branch drop-down list |
| headerBranchItem | layer1-refs.ts | One branch name inside the branch list |
| headerBranchHeadItem | layer1-refs.ts | First choice "(branch head)" in the branch list |
| headerCommitPicker | layer1-components/top-bars/top-bars.html | The "Commit" label with its list |
| headerCommitSelect | layer1-components/top-bars/top-bars.html | Commit drop-down list |
| headerCommitItem | layer1-refs.ts | One commit line inside the commit list |
| headerRefLabel | layer1-components/top-bars/top-bars.html | The "Ref" label with its box |
| headerRefInput | layer1-components/top-bars/top-bars.html | Text box with "default branch" hint |
| headerLoadButton | layer1-components/top-bars/top-bars.html | "Load" button |

### Jump row

| Name | File | What you see |
|---|---|---|
| jumpToRowComponent | layer1-components/top-bars/top-bars.html | The whole row that starts with "Jump to:" |
| jumpToRowNoRepositoryMatchButton | layer1-components/top-bars/top-bars.html | "No repository match" button |
| jumpToRowNoOnDiskMatchButton | layer1-components/top-bars/top-bars.html | "No on-disk match" button |
| jumpToRowFindBox | layer1-components/top-bars/top-bars.html | The "Find bubble" label with its box and list |
| jumpToRowFindFileInput | layer1-components/top-bars/top-bars.html | Text box where you type a file name |
| jumpToRowFindResultsList | layer1-components/top-bars/top-bars.html | Drop-down list of matching files |
| jumpToRowFindSuggestionItem | layer1-components/top-bars/layer1-find-file.ts | One file path in that drop-down list |
| jumpToRowFindPreviousButton | layer1-components/top-bars/top-bars.html | "‹" button, previous match |
| jumpToRowFindNextButton | layer1-components/top-bars/top-bars.html | "›" button, next match |
| jumpToRowFindStatusReadout | layer1-components/top-bars/top-bars.html | Small text such as the match count |
| jumpToRowReverseButton | layer1-components/top-bars/top-bars.html | "reverse" button |
| jumpToRowReverseModifyingOnlyLabel | layer1-components/top-bars/top-bars.html | Label "Show only modifying events for File" |
| jumpToRowReverseModifyingOnlyCheckbox | layer1-components/top-bars/top-bars.html | Check box inside that label |

### Sources (file nav, JSONLs)

| Name | File | What you see |
|---|---|---|
| fileNavComponent | layer1-components/file-nav/file-nav.html | Left upper pane "File Nav" |
| fileNavTitleBar | layer1-components/file-nav/file-nav.html | Title strip of File Nav |
| fileNavShowOnlySelectedButton | layer1-components/file-nav/file-nav.html | "Show Only Selected" button |
| fileNavSearchInput | layer1-components/file-nav/file-nav.html | Box "search files..." |
| fileNavSearchClearButton | layer1-components/file-nav/file-nav.html | "×" button by the file search |
| fileNavTreeList | layer1-components/file-nav/file-nav.html | The file and folder tree |
| fileNavFolderRow | views/sidebar.ts | One folder name line in the tree |
| fileNavFolderItem | views/sidebar.ts | One folder with all that is inside it |
| fileNavFolderToggle | views/sidebar.ts | Small arrow that opens or closes a folder |
| fileNavFileRow | views/sidebar-file-leaf.ts | One file line in the tree |
| fileNavRevisionCountReadout | views/sidebar-file-leaf.ts | Number in brackets after a file name |
| fileNavRenameBadgeText | views/sidebar-file-leaf.ts | Small rename badge on a file line |
| fileNavHeightResizeGrip | layer1-components/file-nav/file-nav.html | Thin bar between File Nav and JSONLs; drag it to change heights |
| fileNavWidthResizeGrip | layer1-components/file-nav/filenav-grip.html | Thin bar at the right of the left panes; drag it to change width |
| jsonlsComponent | layer1-components/jsonls-nav/jsonls-nav.html | Left lower pane "JSONLs" |
| jsonlsPaneTitle | layer1-components/jsonls-nav/jsonls-nav.html | Title strip "JSONLs" |
| jsonlsAllSessionsButton | layer1-components/jsonls-nav/jsonls-nav.html | "All sessions" button |
| jsonlsSessionSearchInput | layer1-components/jsonls-nav/jsonls-nav.html | Box "search titles..." |
| jsonlsSessionSearchClearButton | layer1-components/jsonls-nav/jsonls-nav.html | "×" button by the title search |
| jsonlsSessionList | layer1-components/jsonls-nav/jsonls-nav.html | The list of sessions |
| jsonlsSessionRow | layer1-components/jsonls-nav/layer1-session-pane.ts | One session in the list |
| jsonlsSessionTitleText | layer1-components/jsonls-nav/layer1-session-pane.ts | Title line of a session |
| jsonlsSessionFileNameText | layer1-components/jsonls-nav/layer1-session-pane.ts | JSONL file name of a session |
| jsonlsSessionMetaText | layer1-components/jsonls-nav/layer1-session-pane.ts | Date and "N files" line of a session |
| jsonlsNoJsonlsEmptyText | layer1-components/jsonls-nav/layer1-session-pane.ts | Text "no JSONLs touched this project's files" |
| jsonlsNoMatchesEmptyText | layer1-components/jsonls-nav/layer1-session-pane.ts | Text "no matches" |
| jsonlsScanProgressBar | layer1-components/jsonls-nav/layer1-sessions.ts | Progress bar shown while the JSONLs are scanned |
| jsonlsScanTrackBar | layer1-components/jsonls-nav/layer1-sessions.ts | Empty track of that progress bar |
| jsonlsScanFillBar | layer1-components/jsonls-nav/layer1-sessions.ts | Filled part of that progress bar |
| jsonlsScanLabel | layer1-components/jsonls-nav/layer1-sessions.ts | Text "scanning JSONL files" |
| jsonlsErrorText | layer1-components/jsonls-nav/layer1-sessions.ts | Error text when the scan fails |

### Timeline view controls

| Name | File | What you see |
|---|---|---|
| timelineViewControls | layer1-components/show-row/show-row.html | The row of check boxes above the timeline |
| viewControlsShowLabel | layer1-components/show-row/layer1-show-row.ts | Word "show:" at the start of the row |
| viewControlsKindCheckbox | layer1-components/show-row/layer1-show-row.ts | One check box for one node kind |
| viewControlsKindLabel | layer1-components/show-row/layer1-show-row.ts | Colour swatch and name of one node kind |
| viewControlsKindJumpButton | layer1-components/show-row/layer1-show-row.ts | Small arrow button that jumps to the next or previous node of that kind |
| viewControlsHideIgnoredCheckbox | layer1-components/show-row/layer1-hide-ignored.ts | Check box for "hide ignored nodes" |
| viewControlsHideIgnoredLabel | layer1-components/show-row/layer1-hide-ignored.ts | Label "hide ignored nodes" |
| viewControlsSessionToggleButton | layer1-components/show-row/show-row.html | "session" button at the end of the row |

### Load bar

| Name | File | What you see |
|---|---|---|
| loadBarComponent | layer1-components/loading-bar/loading-bar.html | The whole bar above the timeline while it loads |
| loadBarTrackBar | layer1-components/loading-bar/loading-bar.html | Empty track |
| loadBarFillBar | layer1-components/loading-bar/loading-bar.html | Filled part of the track |
| loadBarLabelText | layer1-components/loading-bar/loading-bar.html | Progress words |
| loadBarCancelButton | layer1-components/loading-bar/loading-bar.html | "Cancel" button |
| loadBarConfirmDialog | layer1-components/loading-bar/loading-bar.html | Question "Cancel this build?" |
| loadBarConfirmYesButton | layer1-components/loading-bar/loading-bar.html | "Yes, cancel" button |
| loadBarConfirmNoButton | layer1-components/loading-bar/loading-bar.html | "No" button in that question |
| loadBarStepList | layer1-components/loading-bar/loading-bar.html | The list of loading steps under the load bar |
| stepConsoleRow | layer1-components/loading-bar/layer1-step-console.ts | One step line in a step list |
| stepConsoleLabelText | layer1-components/loading-bar/layer1-step-console.ts | Name of one step |
| stepConsoleStatusText | layer1-components/loading-bar/layer1-step-console.ts | Status of one step: waiting, running or done |

### Ruler

| Name | File | What you see |
|---|---|---|
| timelineRulerComponent | layer1-components/ruler/ruler.html | The time ruler at the left of the timeline |
| rulerRailBar | layer1-components/ruler/ruler.html | Vertical line of the ruler before it is filled |
| rulerDottedLine | layer1-components/bubbles/layer1-stage-render.ts | Vertical dotted line of the ruler |
| rulerTick | layer1-components/bubbles/layer1-stage-render.ts | One tick mark with its text |
| rulerHeadBar | layer1-components/ruler/layer1-ruler-head.ts | Strip at the top of the ruler |
| rulerTimeText | layer1-components/ruler/layer1-ruler-display.ts | Time text on a tick |
| rulerCountText | layer1-components/ruler/layer1-ruler-display.ts | Count text on a tick |
| rulerKindDashList | layer1-components/ruler/layer1-tick-kinds.ts | Row of small coloured dashes on a tick |
| rulerKindDashTick | layer1-components/ruler/layer1-tick-kinds.ts | One coloured dash, one node kind |
| rulerTickFileList | layer1-components/ruler/layer1-tick-events.ts | List of file buttons under an opened tick |
| rulerTickFileButton | layer1-components/ruler/layer1-tick-events.ts | One file button under an opened tick |

### Session dots

| Name | File | What you see |
|---|---|---|
| sessionDotLinesComponent | layer1-components/session-column/layer1-annotation-track.ts | The column of session dots next to the ruler |
| sessionDotsDot | layer1-components/session-column/layer1-annotation-dots.ts | One round session dot |
| sessionDotsLine | layer1-components/session-column/layer1-annotation-dots.ts | Line that joins two session dots |
| sessionDotsBracket | layer1-components/session-column/layer1-annotation-dots.ts | Bracket that joins two session dots |
| sessionDotsJsonText | layer1-components/session-column/layer1-annotation-click.ts | Raw JSON text in the details pane after a dot click |
| sessionDotsConnector | layer1-components/session-column/layer1-annotation-dots.ts | Thin line from the lane centre to the farthest extra dot of one session line |
| sessionLaneStrip | layer1-components/session-column/layer1-session-lane-strip.ts | Strip of lanes in the session column |

### Commits drawer

| Name | File | What you see |
|---|---|---|
| jfredCommitsDrawerComponent | layer1-components/commits-column/layer1-jfred-strip.ts | The column of jfred commit nodes |
| commitsHeadTitle | layer1-components/commits-column/layer1-jfred-strip.ts | Word "commits" at the top of the column |
| commitsDeleteBranchButton | layer1-components/commits-column/layer1-jfred-strip.ts | "Delete jfred branch" button |
| commitsNodeDot | layer1-components/commits-column/layer1-jfred-entries.ts | One commit dot |
| commitsChainLine | layer1-components/commits-column/layer1-jfred-entries.ts | Line that joins two commit dots |
| commitsHashLabel | layer1-components/commits-column/layer1-jfred-entries.ts | Short hash text beside a commit dot |
| commitsHoverLine | layer1-components/commits-column/layer1-jfred-entries.ts | Horizontal line that shows when you point at a commit dot |
| commitsPendingCommitButton | layer1-components/commits-column/layer1-jfred-drawer.ts | "Commit" button |
| commitsMessageText | layer1-components/commits-column/layer1-jfred-drawer.ts | Commit message text |
| commitsPatchText | layer1-components/commits-column/layer1-jfred-patch.ts | Patch text under a commit message |
| commitsModeButton | layer1-components/commits-column/commits-column.html | "Commit mode" button |

### Minimap

| Name | File | What you see |
|---|---|---|
| minimapComponent | layer1-components/minimap/minimap.html | The small overview box |
| minimapTitleText | layer1-components/minimap/minimap.html | Word "minimap" |
| minimapPlotSection | layer1-components/minimap/minimap.html | The small picture area |
| minimapViewportNode | layer1-components/minimap/minimap.html | Draggable frame for the part you see |
| minimapWashMarkItem | layer1-components/minimap/layer1-minimap.ts | Small band for a wash |
| minimapFileMarkItem | layer1-components/minimap/layer1-minimap.ts | Small box for one file bubble |

### Bubbles and lanes

| Name | File | What you see |
|---|---|---|
| bubbleFileBox | layer1-pair-widget.ts | One file bubble (column) |
| bubbleFileNameText | layer1-pair-widget.ts | File name at the top of a bubble |
| bubbleCommitCountText | layer1-pair-widget.ts | Text such as "3 commits · on disk" |
| bubbleCreationUntrustedText | layer1-pair-widget.ts | Text "creation time not trusted" |
| bubbleLane | layer1-pair-widget.ts | Vertical time lane inside a bubble |
| bubbleLaneRail | layer1-pair-widget.ts | Thin line of that lane |
| bubbleCreatedNode | layer1-pair-widget.ts | Dot for the file creation time |
| bubbleCreatedNodeLabel | layer1-pair-widget.ts | Text "created at" |
| bubbleCommitNode | layer1-pair-widget.ts | Dot for a commit |
| bubbleCommitNodeLabel | layer1-pair-widget.ts | Short commit hash |
| bubbleOnDiskNode | layer1-pair-widget.ts | Dot for the file on disk |
| bubbleOnDiskNodeLabel | layer1-pair-widget.ts | Text "on disk" |
| laneSnapshotNode | layer1-components/bubbles/layer1-lane-nodes.ts | Dot for a file-history snapshot |
| laneSnapshotNodeLabel | layer1-components/bubbles/layer1-lane-nodes.ts | Text "@v" and a number, with a camera |
| laneEditNode | layer1-components/bubbles/layer1-lane-nodes.ts | Dot for an edit or read |
| laneEditNodeLabel | layer1-components/bubbles/layer1-lane-nodes.ts | Text "[e]" or "[R]✓" |
| laneScriptRunNode | layer1-components/bubbles/layer1-lane-nodes.ts | Dot for a script run |
| laneScriptRunNodeLabel | layer1-components/bubbles/layer1-lane-nodes.ts | Text beside a script run dot |
| laneBranchRailBar | layer1-components/bubbles/layer1-lane-nodes.ts | Line of a side branch lane |
| laneBranchNode | layer1-components/bubbles/layer1-lane-nodes.ts | Dot on a side branch lane |
| laneBranchNodeLabel | layer1-components/bubbles/layer1-lane-nodes.ts | Text beside a branch dot |
| laneBranchSplitLink | layer1-components/bubbles/layer1-lane-nodes.ts | Elbow where a branch leaves the lane |
| laneBranchMergeLink | layer1-components/bubbles/layer1-lane-nodes.ts | Elbow where a branch joins the lane |
| laneToolNode | layer1-components/bubbles/layer1-tool-nodes.ts | Dot for a tool call |
| laneToolNodeLabel | layer1-components/bubbles/layer1-tool-nodes.ts | Letter and text beside a tool dot |
| laneToolBracket | layer1-components/bubbles/layer1-tool-nodes.ts | Bracket that joins the two dots of one tool call |
| laneScriptConnectorLink | layer1-components/bubbles/layer1-script-connectors.ts | Line that joins a script run to its files |
| laneSameTimestampItem | layer1-components/bubbles/layer1-nodes-with-same-timestamp.ts | Marker for nodes that share one time |
| bubbleOrphanBucketSection | layer1-widgets.ts | Wide box for files with no match, such as "No repository match" |
| bubbleOrphanBucketTitle | layer1-widgets.ts | Title of that box |
| bubbleOrphanCountText | layer1-widgets.ts | Text such as "5 files" |
| bubbleOrphanRowList | layer1-widgets.ts | List of files in that box |
| bubbleOrphanRow | layer1-widgets.ts | One file line in that list |
| bubbleOrphanPathText | layer1-widgets.ts | File path in that line |
| bubbleOrphanInstantText | layer1-widgets.ts | Date in that line |
| bubbleMoreFilesButton | layer1-widgets.ts | Button such as "+12 more" |
| bubbleMoreFilesList | layer1-widgets.ts | List that opens from the "more" button |
| bubbleNoPairsText | layer1-widgets.ts | Text "No git ↔ on-disk pairs." |
| reverseBubble | layer1-components/bubbles/layer1-reverse-bubble.ts | One file bubble in reverse mode |
| bubbleReverseFileNameText | layer1-components/bubbles/layer1-reverse-bubble.ts | File name at the top of a reverse bubble |
| bubbleReverseStateCountText | layer1-components/bubbles/layer1-reverse-bubble.ts | Text such as "4 states, newest first" |
| reverseBubbleLane | layer1-components/bubbles/layer1-reverse-bubble.ts | Lane inside a reverse bubble |
| bubbleReverseLaneRail | layer1-components/bubbles/layer1-reverse-bubble.ts | Thin line of that lane |
| bubbleReverseStateNode | layer1-components/bubbles/layer1-reverse-bubble.ts | Dot for one file state |
| bubbleReverseStateText | layer1-components/bubbles/layer1-reverse-bubble.ts | Text beside that dot |
| bubbleOrphanSnapshotDot | layer1-widgets.ts | Small dot for a snapshot on an orphan row |

### Timeline marks

| Name | File | What you see |
|---|---|---|
| Leaders | layer1-components/bubbles/bubbles.html | Layer that holds all leader lines |
| timelineLeaderBar | layer1-components/bubbles/layer1-stage-render.ts | One horizontal line from a ruler tick across the bubbles |
| SessionRangeBar | layer1-components/bubbles/bubbles.html | Narrow strip at the left that holds the range bars |
| timelineSessionRangeBar | layer1-components/bubbles/layer1-ranges.ts | One thin range bar for a session |
| timelineWash | layer1-components/bubbles/layer1-wash.ts | Soft coloured band behind the bubbles |
| timelineWashEdgeLabel | layer1-components/bubbles/layer1-diff-wash.ts | Text "selected diff range base" or "target" on the ruler |

### Details pane

| Name | File | What you see |
|---|---|---|
| detailsPaneContainer | layer1-components/details-drawer/details-drawer.html | The panel at the right that opens on a click |
| detailsPaneResizeGrip | layer1-components/details-drawer/details-drawer.html | Thin bar at the left edge of the panel; drag it to change width |
| detailsPaneFilePathText | layer1-components/details-drawer/details-drawer.html | File path at the top |
| detailsPanePreviousRevisionButton | layer1-components/details-drawer/details-drawer.html | "↑" button |
| detailsPaneNextRevisionButton | layer1-components/details-drawer/details-drawer.html | "↓" button |
| detailsPaneImageZoomOutButton | layer1-components/details-drawer/details-drawer.html | "−" button for images |
| detailsPaneImageZoomFitButton | layer1-components/details-drawer/details-drawer.html | "fit" button for images |
| detailsPaneImageZoomInButton | layer1-components/details-drawer/details-drawer.html | "+" button for images |
| detailsPaneCollapseAllButton | layer1-components/details-drawer/details-drawer.html | "Collapse all" button |
| detailsPaneCopyLinkButton | layer1-components/details-drawer/details-drawer.html | "Copy link" button |
| detailsPaneCloseButton | layer1-components/details-drawer/details-drawer.html | "Close" button |
| detailsPaneMetaText | layer1-components/details-drawer/details-drawer.html | Small info line under the top strip |
| detailsPaneImagePreviewItem | layer1-components/details-drawer/layer1-drawer-image.ts | The picture of an image file |
| detailsPaneNoDiffText | layer1-components/details-drawer/layer1-diff-pane.ts | Text "No text differences between these revisions." |
| detailsPaneLineRawJsonToggle | layer1-components/details-drawer/layer1-drawer-node-detail.ts | Switch that shows the raw JSON of a line |
| detailsPaneNodeRawJsonToggle | layer1-components/details-drawer/layer1-drawer-node-detail.ts | Switch that shows the raw JSON of a node |
| detailsPaneRawJsonExpandButton | inspector-json.ts | Button that opens a long raw JSON text |
| detailsPaneRawJsonText | inspector-json.ts | Raw JSON text block |
| detailsPaneRawJsonFormatButton | layer1-components/details-drawer/layer1-drawer-node-detail.ts | 'format' button that shows a raw JSON value as code |

### Diff view

| Name | File | What you see |
|---|---|---|
| diffViewFileSection | layer1-components/details-drawer/layer1-diff-view.ts | One fold-open section for one file |
| diffViewFileHeader | layer1-components/details-drawer/layer1-diff-view.ts | Header strip of a changed file |
| diffViewFilePathText | layer1-components/details-drawer/layer1-diff-view.ts | File name in a section header |
| diffViewDeletedFileHeader | layer1-components/details-drawer/layer1-diff-view.ts | Header strip of a deleted file |
| diffViewDeletedText | layer1-components/details-drawer/layer1-diff-view.ts | Text "Deleted — no on-disk state to show." |
| diffViewImageFileHeader | layer1-components/details-drawer/layer1-diff-view.ts | Header strip of an image file |
| diffViewImageBody | layer1-components/details-drawer/layer1-diff-view.ts | Body of an image file section |
| diffViewPairLabelText | layer1-components/details-drawer/layer1-diff-view.ts | Label for the two revisions that are compared |
| diffViewBaseSideNameText | layer1-components/details-drawer/layer1-diff-view.ts | Words "Base commit" |
| diffViewTargetSideNameText | layer1-components/details-drawer/layer1-diff-view.ts | Words "Target commit" |
| diffViewRevisionArrowButton | layer1-components/details-drawer/layer1-diff-view.ts | Small arrow that moves one side to another revision |
| diffViewToolsBar | layer1-components/details-drawer/layer1-diff-view.ts | Strip of diff buttons |
| diffViewSideBySideButton | layer1-components/details-drawer/layer1-diff-view.ts | "diff side-by-side" button |
| diffViewInlineButton | layer1-components/details-drawer/layer1-diff-view.ts | "diff inline" button |
| diffViewFullContentLabel | layer1-components/details-drawer/layer1-diff-view.ts | Label " full content" |
| diffViewFullContentCheckbox | layer1-components/details-drawer/layer1-diff-view.ts | Check box in that label |
| diffViewExportPatchButton | layer1-components/details-drawer/layer1-diff-view.ts | "export as patch" button |
| diffViewMetaText | layer1-components/details-drawer/layer1-diff-view.ts | Small info line of a file section |
| diffViewFileBody | layer1-components/details-drawer/layer1-diff-view.ts | Body that holds the diff lines |
| diffViewInlineLineList | diff-render.ts | Inline diff, all lines |
| diffViewInlineLineRow | diff-render.ts | Inline diff, one line |
| diffViewInlineLineNumber | diff-render.ts | Inline diff, number at the left of a line |
| diffViewSplitLineList | diff-render.ts | Side-by-side diff, all lines |
| diffViewSplitHunkText | diff-render.ts | Side-by-side diff, hunk header line |
| diffViewSplitLineCell | diff-render.ts | Side-by-side diff, text of one side |
| diffViewSplitLineNumber | diff-render.ts | Side-by-side diff, line number of one side |
| diffViewSplitEmptyCell | diff-render.ts | Side-by-side diff, blank side |
| diffViewSplitEmptyLineNumber | diff-render.ts | Side-by-side diff, blank line number |

### Script run drawer

| Name | File | What you see |
|---|---|---|
| scriptRunBodyHeadBar | layer1-components/details-drawer/layer1-script-run-drawer.ts | Header strip of the script code section |
| scriptRunBodyTitle | layer1-components/details-drawer/layer1-script-run-drawer.ts | Bold script title |
| scriptRunProvenanceText | layer1-components/details-drawer/layer1-script-run-drawer.ts | Small text that says where the script came from |
| scriptRunBodyCodeText | layer1-components/details-drawer/layer1-script-run-drawer.ts | The script code |
| scriptRunMetaFoldBar | layer1-components/details-drawer/layer1-script-run-drawer.ts | Fold bar "kind, executor, instant, session, line, tool use id" |
| scriptRunMetaList | layer1-components/details-drawer/layer1-script-run-drawer.ts | List of script facts |
| scriptRunMetaTermText | layer1-components/details-drawer/layer1-script-run-drawer.ts | Name of one fact |
| scriptRunMetaValueText | layer1-components/details-drawer/layer1-script-run-drawer.ts | Value of one fact |
| scriptRunNoBubbleFoldBar | layer1-components/details-drawer/layer1-script-run-drawer.ts | Fold bar "Changed, no bubble" |
| scriptRunNoBubbleFileRow | layer1-components/details-drawer/layer1-script-run-drawer.ts | One changed file that has no bubble |
| scriptRunFoldSection | layer1-components/details-drawer/layer1-script-run-folds.ts | One fold-open box in the script run view |
| scriptRunFileFoldBar | layer1-components/details-drawer/layer1-script-run-folds.ts | Fold bar with a title and "N affected file(s)" |
| scriptRunFileFoldPathsText | layer1-components/details-drawer/layer1-script-run-folds.ts | List of file paths in that fold |
| scriptRunStatusCheckText | layer1-components/details-drawer/layer1-script-run-status.ts | Name of one check |
| scriptRunStatusMarkText | layer1-components/details-drawer/layer1-script-run-status.ts | Green tick or red cross for that check |
| scriptRunConsoleOpenButton | layer1-components/details-drawer/layer1-run-console.ts | "Open run console" button |
| scriptRunConsolePopup | layer1-components/details-drawer/layer1-run-console.ts | The run console window |
| scriptRunConsoleTitle | layer1-components/details-drawer/layer1-run-console.ts | Words "Run output" |
| scriptRunConsoleCloseButton | layer1-components/details-drawer/layer1-run-console.ts | "Close" button of the console |
| scriptRunConsoleOutputText | layer1-components/details-drawer/layer1-run-console.ts | Printed output of the script |
| scriptRunConsoleStderrText | layer1-components/details-drawer/layer1-run-console.ts | Error output of the script |
| scriptRunConsoleNoteText | layer1-components/details-drawer/layer1-run-console.ts | Short note paragraph in the console |
| scriptRunConsoleCancelButton | layer1-components/details-drawer/layer1-run-console.ts | Cancel button of a running script |
| scriptRunConsoleTerminalBlock | layer1-components/details-drawer/layer1-run-console.ts | Box that shows how the run ended |
| scriptRunConsoleTerminalTitle | layer1-components/details-drawer/layer1-run-console.ts | Bold end state in that box |
| scriptRunConsoleTerminalDescriptionText | layer1-components/details-drawer/layer1-run-console.ts | Explanation in that box |

### Popups

| Name | File | What you see |
|---|---|---|
| pathPickerJsonlSourcesComponent | layer1-components/popups/popups.html | Dark screen behind the source folder dialog |
| pathPickerPopup | layer1-components/popups/popups.html | The source folder dialog |
| pathPickerTitle | layer1-components/popups/popups.html | Title of that dialog |
| pathPickerFolderList | layer1-components/popups/popups.html | List of folders |
| pathPickerFolderRow | layer1-components/popups/layer1-path-picker.ts | One folder path in the list |
| pathPickerEmptyText | layer1-components/popups/layer1-path-picker.ts | Text "no source folders" |
| pathPickerHintText | layer1-components/popups/popups.html | Text "earlier folders win on conflict" |
| pathPickerAlertText | layer1-components/popups/popups.html | Red warning line |
| pathPickerAddButton | layer1-components/popups/popups.html | "+" button |
| pathPickerRemoveButton | layer1-components/popups/popups.html | "−" button |
| pathPickerMoveUpButton | layer1-components/popups/popups.html | "↑" button |
| pathPickerMoveDownButton | layer1-components/popups/popups.html | "↓" button |
| pathPickerCancelButton | layer1-components/popups/popups.html | "cancel" button |
| pathPickerSetAndCloseButton | layer1-components/popups/popups.html | "set and close" button |
| toastPopup | layer1-components/popups/toast.html | Small message that shows for a short time |
| hoverPopupPopup | layer1-components/popups/layer1-hover-popup.ts | Small box that shows when you point at a node |
| hoverPopupLineText | layer1-components/popups/layer1-hover-popup.ts | One text line in that box |
| busyShieldDialog | layer1-components/popups/busy-shield.html | Centre card that blocks the page while work runs |
| busyShieldProgressBar | layer1-components/popups/busy-shield.html | Progress bar in that card |
| busyShieldStatusText | layer1-components/popups/busy-shield.html | Status words in that card |
| busyShieldCancelButton | layer1-components/popups/busy-shield.html | "Cancel" button in that card |
| busyShieldErrorText | layer1-components/popups/busy-shield.html | Error text in that card |
| busyShieldCloseButton | layer1-components/popups/busy-shield.html | "Close" button in that card |
| runConsentPopup | layer1-components/popups/layer1-run-consent.ts | Dark screen behind the replay question |
| runConsentDialog | layer1-components/popups/layer1-run-consent.ts | The replay question box |
| runConsentTitle | layer1-components/popups/layer1-run-consent.ts | Title "Replay recorded scripts?" |
| runConsentNoteText | layer1-components/popups/layer1-run-consent.ts | Paragraph that explains the replay |
| runConsentScriptCountText | layer1-components/popups/layer1-run-consent.ts | Text such as "3 recorded script(s) can run on this page" |
| runConsentRunButton | layer1-components/popups/layer1-run-consent.ts | "Run scripts" button |
| runConsentContinueWithoutRunningButton | layer1-components/popups/layer1-run-consent.ts | "Continue without running" button |
| runConsentScriptRow | app-consent-rows.ts | One script line in the replay question |
| runConsentScriptTimeText | app-consent-rows.ts | Time and folder of that script |
| runConsentScriptCodeText | app-consent-rows.ts | Code of that script |
| runConsentScriptExpandButton | app-consent-rows.ts | "Expand" button |
| runBlockedPopup | layer1-components/popups/layer1-run-blocked-popup.ts | Small box that says a script run is blocked |
| runBlockedMessageText | layer1-components/popups/layer1-run-blocked-popup.ts | Reason text in that box |
| runBlockedFirstScriptStateText | layer1-components/popups/layer1-run-blocked-popup.ts | File name and state of the first blocking script |
| runBlockedGoToFirstButton | layer1-components/popups/layer1-run-blocked-popup.ts | "Go to first unreplayed script node" button |
| runBlockedCloseButton | layer1-components/popups/layer1-run-blocked-popup.ts | "close" button |
| yesNoRow | layer1-components/popups/layer1-yes-no-row.ts | Row with a question and two buttons |
| yesNoQuestionText | layer1-components/popups/layer1-yes-no-row.ts | The question |
| yesNoYesButton | layer1-components/popups/layer1-yes-no-row.ts | Yes button |
| yesNoNoButton | layer1-components/popups/layer1-yes-no-row.ts | No button |
| busyShieldStepList | layer1-components/popups/busy-shield.html | The step list inside the busy card |
| missingExecutablesPopup | layer1-components/popups/layer1-run-consent.ts | Screen behind the missing programs dialog |
| missingExecutablesDialog | layer1-components/popups/layer1-run-consent.ts | The missing programs dialog |
| missingExecutablesTitle | layer1-components/popups/layer1-run-consent.ts | Title "Programs missing from the script image" |
| missingExecutableLineText | layer1-components/popups/layer1-run-consent.ts | One line naming a missing program or module |
| missingExecutablesCloseButton | layer1-components/popups/layer1-run-consent.ts | "Close" button of the missing programs dialog |
| runConsentProblemText | layer1-components/popups/layer1-run-consent.ts | Note that names the problem with a script run |
| runConsentWaitingFilesText | layer1-components/popups/layer1-run-consent.ts | Line "waiting files: ..." under a script run |
| runConsentEarlierScriptText | layer1-components/popups/layer1-run-consent.ts | Line "earlier script, needed as input" under a script run |

### engineV3 bar

| Name | File | What you see |
|---|---|---|
| engineV3Bar | layer1-components/engine-v3/engine-v3.html | The whole engineV3 step bar |
| engineV3BarTitle | layer1-components/engine-v3/engine-v3.html | Text "engineV3 mockup (fake steps):" |
| engineV3StartOverButton | layer1-components/engine-v3/engine-v3.html | "Start over" button |
| engineV3PreviousCommitButton | layer1-components/engine-v3/engine-v3.html | "Jump to previous commit" button |
| engineV3StepBackwardsButton | layer1-components/engine-v3/engine-v3.html | "Step backwards" button |
| engineV3StepForwardButton | layer1-components/engine-v3/engine-v3.html | "Step forward" button |
| engineV3NextCommitButton | layer1-components/engine-v3/engine-v3.html | "Jump to next commit" button |
| engineV3ReadoutText | layer1-components/engine-v3/engine-v3.html | Sentence and file list for the current step |
| engineV3CurrentStepTick | layer1-components/engine-v3/layer1-engine-v3-line.ts | Line on the timeline that marks the current step |

### Bars view

| Name | File | What you see |
|---|---|---|
| barsViewSlider | layer1-components/bars-view/bars-view-slider.html | Label "Bars ... Bubbles" beside the reverse button |
| barsViewSliderInput | layer1-components/bars-view/bars-view-slider.html | Two-step slider that picks Bars or Bubbles |
| barsViewComponent | layer1-components/bars-view/bars-view.html | The whole Bars view inside the canvas |
| barsTimelineArea | layer1-components/bars-view/bars-view.html | Box that holds the sticky header and the rows |
| barsStickyHeader | layer1-components/bars-view/bars-view.html | Header that stays at the top while the rows scroll |
| barsToolbar | layer1-components/bars-view/bars-view.html | Row with the events button |
| barsEventsViewButton | layer1-components/bars-view/bars-view.html | Button "Events: dots under bar" or "Events: segments in bar" |
| barsHeaderLine | layer1-components/bars-view/bars-view.html | Header sentence with the file count |
| barsStatusLine | layer1-components/bars-view/bars-view.html | Status sentence while the history loads |
| barsReadBar | layer1-components/bars-view/bars-view.html | Moving stripe while the logs are read |
| barsReadBarFill | layer1-components/bars-view/bars-view.html | The moving stripe |
| barsRows | layer1-components/bars-view/bars-view.html | Scroll area of the file rows |
| barsRowList | layer1-components/bars-view/bars-view.html | List that holds the file rows |
| barsFileRow | layer1-components/bars-view/layer1-bars-row.ts | One file row |
| barsColLeft | layer1-components/bars-view/layer1-bars-row.ts | Left column of a row: mark and file path |
| barsColMid | layer1-components/bars-view/layer1-bars-row.ts | Middle column of a row: the bar |
| barsColRight | layer1-components/bars-view/layer1-bars-row.ts | Right column of a row: step text |
| barsMark | layer1-components/bars-view/layer1-bars-row.ts | Small mark: waiting, running or done |
| barsFilePath | layer1-components/bars-view/layer1-bars-row.ts | File path text; click opens the file details |
| barsProjectLifetimeBar | layer1-components/bars-view/layer1-bars-row.ts | The bar of one file over the project lifetime |
| barsFileReconstructionProgressBar | layer1-components/bars-view/layer1-bars-row.ts | Progress bar of one file while the history loads |
| barsFill | layer1-components/bars-view/layer1-bars-row.ts | Grey fill up to the selected ruler row |
| barsPlusSign | layer1-components/bars-view/layer1-bars-row.ts | Plus sign before a file that was created |
| barsMinusSign | layer1-components/bars-view/layer1-bars-row.ts | Minus sign for a deleted file |
| barsMovedAwaySign | layer1-components/bars-view/layer1-bars-row.ts | Arrow for a file that moved away |
| barsDotStrip | layer1-components/bars-view/layer1-bars-row.ts | Strip of event dots under the bar |
| barsDot | layer1-components/bars-view/layer1-bars-row.ts | One event dot; click opens the details pane |
| barsHistoryBlock | layer1-components/bars-view/layer1-bars-row.ts | Coloured chunk of change history |
| barsTargetLine | layer1-components/bars-view/layer1-bars-rowlist.ts | One vertical line across all bars at the selected ruler row (#barsTargetLine) |
| barsFoldLine | layer1-components/bars-view/layer1-bars-rowlist.ts | Line "N files with no change since this row" |
| barsFoldToggle | layer1-components/bars-view/layer1-bars-rowlist.ts | The [hide] or [show] word on the fold line |
| barsFoldedList | layer1-components/bars-view/layer1-bars-rowlist.ts | Rows folded under the fold line |
| barsArrow | layer1-components/bars-view/layer1-bars-header.ts | Green arrow before a header line |
| barsCutStrip | layer1-components/bars-view/layer1-bars-cut-strip.ts | Pinned commit strip above the rows |
| barsCutStripLeft | layer1-components/bars-view/layer1-bars-cut-strip.ts | Left column of the strip |
| barsCutStripMiddle | layer1-components/bars-view/layer1-bars-cut-strip.ts | Middle column of the strip |
| barsCutStripRight | layer1-components/bars-view/layer1-bars-cut-strip.ts | Right column of the strip |
| barsCutDeleteBranch | layer1-components/bars-view/layer1-bars-cut-strip.ts | Words "Delete jfred branch" |
| barsCutBranchLine | layer1-components/bars-view/layer1-bars-cut-strip.ts | Line of the jfred branch |
| barsCutCap | layer1-components/bars-view/layer1-bars-cut-strip.ts | Cap at the end of a commit on the strip |
| barsCutHashLabel | layer1-components/bars-view/layer1-bars-cut-strip.ts | Short hash of a commit |
| barsCutDottedLine | layer1-components/bars-view/layer1-bars-cut-strip.ts | Dotted line from a commit down the rows |
| barsCutScissors | layer1-components/bars-view/layer1-bars-cut-strip.ts | Scissors mark on a row; click marks a cut |
| barsCutBranchLabel | layer1-components/bars-view/layer1-bars-cut-strip.ts | Words "jfred branch" |
| barsCutCommitButton | layer1-components/bars-view/layer1-bars-cut-strip.ts | "Commit" button, shown when a mark is pending |
| barsCutHint | layer1-components/bars-view/layer1-bars-cut-strip.ts | Words "click scissors to mark" |
| barsLogFileLine | layer1-components/bars-view/bars-view.html | Line with the name of the log file being read |

### Page boxes

| Name | File | What you see |
|---|---|---|
| appWindow | layer1.html | The whole page |
| headerContainer | layer1-layout.ts | Box above the session data; holds the header rows |
| headerRowComponent | layer1-layout.ts | Top row with the title and the small buttons |
| sessionDataContainer | layer1-layout.ts | Box under the header; holds sources and timeline |
| sourcesContainer | layer1-layout.ts | Left column with File Nav and JSONLs |
| timelineComponentsContainer | layer1-layout.ts | Right column with load bar, view controls, and timeline |
| timelineContainer | layer1-layout.ts | The scroll box of the timeline |
| timelineRulerContainer | layer1-layout.ts | Left sticky box with minimap, ruler, session dots, commits drawer |
| fileBubbleContainer | layer1-layout.ts | Main area with all file bubbles |

### Layered page and debug page

| Name | File | What you see |
|---|---|---|
| layeredHeader | index.html | Top bar of the layered page |
| layeredDrawerToggleButton | index.html | "☰" button that folds the left drawer |
| layeredNamesToggleButton | index.html | "names" button |
| layeredTitleText | index.html | Title "JFRED — Layered Timeline" |
| layeredClassicAppLink | index.html | Link "classic app" |
| layeredApp | index.html | Box that holds the drawer, the timeline and the right side |
| layeredDrawer | index.html | Left drawer with the session list and the file nav |
| layeredSessionList | index.html | List of JSONL sessions |
| layeredFileNav | index.html | File tree |
| layeredTimeline | index.html | Middle part with the legend and the timeline |
| layeredLegend | index.html | Row of colored marks and their meaning |
| layeredTimelineScroll | index.html | Scroll box around the timeline |
| layeredCanvas | index.html | Box the timeline is drawn in |
| layeredRight | index.html | Right side with details and changes |
| layeredDetails | index.html | Details of the picked node |
| layeredChanges | index.html | List of changes (hidden until used) |
| debugHeader | debug.html | Top bar of the debug page |
| debugNamesToggleButton | debug.html | "names" button |
| debugTitleText | debug.html | Title "JFRED — Per-file Debug Viewer" |
| debugMainAppLink | debug.html | Link "main app" |
| debugMain | debug.html | Main part of the debug page |
| debugStatusText | debug.html | Status line |
| debugFileList | debug.html | List of files |
| debugLadder | debug.html | Numbered list of the picked file's steps |
