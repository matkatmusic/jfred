// The shared render state of one renderTimelineView pass (task 92 split). renderTimelineView builds one TimelineRenderContext and hands it to every timeline-render-* module function; the function-valued members are assigned by renderTimelineView after construction so the extracted groups can call each other without import cycles.

import type { DetailsContext } from "./details-model.ts";
import type { WireProjectListing } from "./timeline-sessions.ts";
import type {
    TimelineNode,
    TranscriptLocation,
    WireTimelineDocument,
} from "./timeline-types.ts";

export type TimelineRenderContext = {
    // ── inputs of the render pass ──
    project: string;
    nodes: TimelineNode[];
    listing: WireProjectListing | undefined;
    reconstructionDocument: WireTimelineDocument;
    sessionColors: Map<string, string>;

    // ── per-render collections ──
    pickBoxes: Map<number, HTMLInputElement>;              // node index -> checkbox
    nodeRows: Map<number, HTMLElement>;                    // node index -> row element
    previewPanes: Map<number, HTMLElement>;                // node index -> its fallback-message pane
    expandableRows: HTMLElement[];                         // rows #toggle-all expands/collapses
    lineLabels: Map<number, string>;                       // node index -> "L:<n> (of <total>)"
    chipLineLocations: Map<string, TranscriptLocation>;    // `${nodeIndex}:${path}` -> causing line
    laneRuns: { startIndex: number; endIndex: number }[];
    detailsContext: DetailsContext;

    // ── mutable selection state ──
    selectedRow: HTMLElement | null;
    fileNavReferenceIndex: number;                         // last selected/jumped row (task 85 Prev/Next)
    pickedIndexes: number[];
    activeChip: HTMLElement | null;                        // the chip whose file the preview drawer is showing
    cachedPatch: { key: string; text: string };

    // ── DOM anchors shared across groups ──
    selectbar: HTMLElement;
    barText: HTMLElement;
    ruleHint: HTMLElement;

    // ── cross-group calls (assigned by renderTimelineView after construction) ──
    selectTimelineRow: (nodeIndex: number) => Promise<void>;
    jumpToTimelineRow: (nodeIndex: number) => void;
    openNodeInspector: (nodeIndex: number) => void;
    clearActiveChip: () => void;
    markChipActive: (chipElement: HTMLElement) => void;
    updateSelectbar: () => void;
    refreshFileNavButtons: () => void;                     // no-op until wireFileNavButtons runs
    updateToggleLabel: () => void;                         // no-op until wireToggleAllButton runs
};
