// TypeScript port of the decision ledger `from-scratch-reconstruction.hpp`, which stays sketch-only.

import { Path } from "./structures/domain.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";

// UTC-ms axis; JSONL is master clock, hydrated from evidence only.
export type Instant = Date;

// Evidence pointer "<jsonl>:L67"; snapshots resolve via owning session's sidecar (Q12).
export interface JsonlRef {
    sessionFile: Path;
    line: number;
}

// Full-content evidence; timeline's first beacon is its ANCHOR (Q14).
export interface BeaconNode {
    kind: LayeredNodeKind.beacon;
    instant: Instant;
    content: string;
    // Undefined for git or sidecar backup beacons (no JSONL line exists).
    evidence: JsonlRef | undefined;
}

// A byteless mention before the anchor (Q14): position + evidence known, content unknown. Display/placement only; byte-consuming operations refuse stubs.
export interface PreAnchorStubNode {
    kind: LayeredNodeKind.preAnchorStub;
    instant: Instant;
    evidence: JsonlRef;
}

// The file's current on-disk state — every timeline's final node (spec S2).
export interface EndStateNode {
    kind: LayeredNodeKind.endState;
    instant: Instant;
    content: string;
}

// Unexplained adjacent-pair diff (Q8); presumed user edit until explained.
export interface PresumedUserEditNode {
    kind: LayeredNodeKind.presumedUserEdit;
    instant: Instant;
}

// Recorded script execution; `code` is reconstructed text (Q20).
export interface ScriptRunNode {
    kind: LayeredNodeKind.scriptRun;
    instant: Instant;
    code: string;
    evidence: JsonlRef;
}

export type TimelineNode =
    | BeaconNode
    | PreAnchorStubNode
    | EndStateNode
    | PresumedUserEditNode
    | ScriptRunNode;

// One file's nodes, ordered by Instant.
export interface Timeline {
    nodes: TimelineNode[];
}

// One file as seen by ONE session (Q12) — evidence stays scoped to its owning session.
export interface SessionTimeline {
    sessionFile: Path;
    timeline: Timeline;
}

// Merged multi-session node (S5); per-session timelines remain stored truth (Q13).
export interface MergedNode {
    node: TimelineNode;
    // Observing session; undefined for end states and merged-level presumption gaps.
    sessionFile: Path | undefined;
    // Other sessions observing these bytes; drives S8 cross-lane lines.
    corroboratedBy: Path[];
}

// One entity's nodes across every session, ordered on the shared instant axis.
export interface MergedTimeline {
    nodes: MergedNode[];
}

// One entity per distinct file; identity is cwd-resolved absolute path (Q13, S5).
export interface ReconstructionEntity {
    filename: Path;
    sessionTimelines: SessionTimeline[];
}

// Typed directed edges (Q11) replace untyped linked-entity groups; lineage is derived by walking RenameEdges on demand (spec S6).

// Sequential identity: renamedFrom's timeline ends here; renamedTo's begins.
export interface RenameEdge {
    renamedFrom: ReconstructionEntity;
    renamedTo: ReconstructionEntity;
    timestampOfRename: Instant;
    evidence: JsonlRef;
}

// Fork, not sequence: both entities alive after the copy; bornCopy's first content is copiedFrom's reconstructed state at timestampOfCopy.
export interface CopyEdge {
    copiedFrom: ReconstructionEntity;
    timestampOfCopy: Instant;
    bornCopy: ReconstructionEntity;
    evidence: JsonlRef;
}

// Evidence dependency, not identity, consulted only by the layer-10 executor; a verified replay confirms nodes on every filesWritten timeline.
export interface ScriptDependsOn {
    scriptRun: ScriptRunNode;
    filesRead: ReconstructionEntity[];
    filesWritten: ReconstructionEntity[];
    evidence: JsonlRef;
}

export interface ReconstructionGraph {
    entities: ReconstructionEntity[];
    renames: RenameEdge[];
    copies: CopyEdge[];
    scriptLinks: ScriptDependsOn[];
}

