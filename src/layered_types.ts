// TypeScript port of the decision ledger `from-scratch-reconstruction.hpp`, which stays sketch-only.

import { Path } from "./structures/domain.ts";
import { LayeredNodeKind } from "./structures/vocabulary.ts";

// Shared UTC-ms axis: JSONL ms is the master clock, git committer seconds are widened ×1000 by the
// loader, and values are hydrated only from recorded evidence, never `new Date()` "now".
export type Instant = Date;

// Evidence pointer "<jsonl>:L67" — also the provenance namespace: snapshot references
// (abc123@vN) resolve through the OWNING session's sidecar, never a global name lookup (Q12).
export interface JsonlRef {
    sessionFile: Path;
    line: number;
}

// Verified full-content evidence: commit blob, file-history snapshot, Write body, complete
// Read echo, or populated originalFile. The first beacon of a timeline is its ANCHOR (Q14).
export interface BeaconNode {
    kind: LayeredNodeKind.beacon;
    instant: Instant;
    content: string;
    // Undefined when the beacon came from git or the sidecar backup timeline (neither carries
    // a JSONL line to point at).
    evidence: JsonlRef | undefined;
}

// A byteless mention before the anchor (Q14): position + evidence known, content unknown.
// Display/placement only — byte-consuming operations refuse unpromoted stubs.
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

// An unexplained adjacent-pair diff (Q8 invariant): presumed a user edit until a layer explains
// it — the engine may leave a gap but may never invent an attribution.
export interface PresumedUserEditNode {
    kind: LayeredNodeKind.presumedUserEdit;
    instant: Instant;
}

// A recorded script execution; the body is itself a reconstructed entity (Q20), so `code` here
// is the recovered text. Verification is layer-10 replay, not this type's concern.
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

// One node of an entity's merged multi-session view (spec S5). The merge is DERIVED — the
// per-session SessionTimelines stay the stored truth (Q13).
export interface MergedNode {
    node: TimelineNode;
    // The session that observed it; undefined for nodes belonging to no session — the on-disk
    // end state (one file, one disk) and merged-level presumption gaps.
    sessionFile: Path | undefined;
    // The OTHER sessions that observed these same bytes — the input for spec S8's dashed
    // cross-lane lines. Empty unless at least two DISTINCT sessions observed the content.
    corroboratedBy: Path[];
}

// One entity's nodes across every session, ordered on the shared instant axis.
export interface MergedTimeline {
    nodes: MergedNode[];
}

// The unit that owns a file's history; one per distinct file. Identity = absolute path after
// per-session cwd resolution. Layers operate on a DERIVED merged view of these (Q13, spec S5).
export interface ReconstructionEntity {
    filename: Path;
    sessionTimelines: SessionTimeline[];
}

// Typed directed edges (Q11) — these REPLACE untyped linked-entity groups; lineage is derived
// by walking RenameEdges on demand (spec S6), never stored as a group.

// Sequential identity: renamedFrom's timeline ends here; renamedTo's begins.
export interface RenameEdge {
    renamedFrom: ReconstructionEntity;
    renamedTo: ReconstructionEntity;
    timestampOfRename: Instant;
    evidence: JsonlRef;
}

// Fork, not sequence: both entities alive after the copy; bornCopy's first content is
// copiedFrom's reconstructed state at timestampOfCopy.
export interface CopyEdge {
    copiedFrom: ReconstructionEntity;
    timestampOfCopy: Instant;
    bornCopy: ReconstructionEntity;
    evidence: JsonlRef;
}

// Evidence dependency, NOT identity — consulted only by the layer-10 executor; a verified
// replay confirms nodes on every filesWritten timeline.
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
