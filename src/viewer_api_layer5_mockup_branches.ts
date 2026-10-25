// Task 379 canned forked lanes for two fixture bubbles, served in the real /api/layer1-branches wire shape (task 357).

import { WireRewindKind, type WireBranchesViewOf } from "../webapp/layer1-wire-branches.ts";
import { WireEditSide } from "../webapp/layer1-wire-edits.ts";
import { LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES } from "./layer1_branches_wire.ts";
import { Path, Uuid } from "./structures/domain.ts";
import { DocumentResponseKind } from "./structures/vocabulary_views.ts";
// import type { Layer1WirePair } from "./viewer_api_layer1.ts";
import { listTemplateLines } from "./viewer_api_layer1_fixture_content.ts";
import { parseMs } from "./viewer_api_layer1_fixture_data.ts";

interface MockBranchSpec {
  rewindKind: WireRewindKind;
  forkAt: string;
  rejoinAt?: string;
  nodes: { at: string; label: string }[];
}

// forkAt sits one minute after its trunk commit (a fork owns a ladder slot); rejoinAt equals a trunk commit instant.
const MOCK_BRANCHES: Record<string, MockBranchSpec[]> = {
  "src/util.ts": [
    { rewindKind: WireRewindKind.code, forkAt: "2026-06-01T14:31:00Z",
      nodes: [{ at: "2026-06-02T10:30:00Z", label: "try alt trim" }, { at: "2026-06-02T12:00:00Z", label: "tune trim" }] },
  ],
  "src/index.ts": [
    { rewindKind: WireRewindKind.conversation, forkAt: "2026-06-01T14:31:00Z", rejoinAt: "2026-06-03T18:20:00Z",
      nodes: [{ at: "2026-06-02T09:00:00Z", label: "reword ask" }, { at: "2026-06-02T11:00:00Z", label: "refine ask" }] },
    { rewindKind: WireRewindKind.code, forkAt: "2026-06-03T18:21:00Z",
      nodes: [{ at: "2026-06-05T10:00:00Z", label: "try split" }, { at: "2026-06-05T12:00:00Z", label: "tune split" }] },
  ],
};

// A canned lane node's before is the path's template; its after adds one line naming the node.
export function readFixtureBranchFile(path: string, changeId: string, side: string): { content: string } {
  const before = listTemplateLines(path);
  return { content: (side === WireEditSide.base ? before : [...before, `// ${changeId}`]).join("\n") };
}

type FixtureBranchesView =WireBranchesViewOf<Date, Path, Uuid>;

export function buildFixtureBranchesPayload(writeNdjsonLine: (value: unknown) => void): FixtureBranchesView {
  writeNdjsonLine({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_FINDING_BRANCHES, current: 1, total: 1 });
  writeNdjsonLine({ kind: DocumentResponseKind.progress, label: LAYER1_PROGRESS_LABEL_RECONSTRUCTING_BRANCHES, current: 1, total: 1 });
  return {
    pairs: Object.entries(MOCK_BRANCHES).map(([path, specs], pathIndex) => ({
      path: new Path(path),
      branches: specs.map((spec, laneIndex) => ({
        rewindKind: spec.rewindKind,
        forkAt: new Date(parseMs(spec.forkAt)),
        ...(spec.rejoinAt === undefined ? {} : { rejoinAt: new Date(parseMs(spec.rejoinAt)) }),
        nodes: spec.nodes.map((node, nodeIndex) => ({
          instant: new Date(parseMs(node.at)),
          changeId: new Uuid(`toolu_fixture_branch_${pathIndex}_${laneIndex}_${nodeIndex}`),
          label: node.label,
        })),
      })),
    })),
  };
}

/* Task 357: the fixture Layer 1 view no longer embeds lanes; they arrive from /api/layer1-branches.
interface EmbeddedMockBranchSpec {
  rewindKind: WireRewindKind;
  forkFrom: string;
  rejoinAt?: string;
  nodes: { at: string; label: string }[];
}

// HEAD copy of the canned lanes the fixture L1 view embeds: fork/rejoin equal existing trunk commit instants.
const EMBEDDED_MOCK_BRANCHES: Record<string, EmbeddedMockBranchSpec[]> = {
  "src/util.ts": [
    { rewindKind: WireRewindKind.code, forkFrom: "2026-06-01T14:30:00Z",
      nodes: [{ at: "2026-06-02T10:30:00Z", label: "try alt trim" }, { at: "2026-06-02T12:00:00Z", label: "tune trim" }] },
  ],
  "src/index.ts": [
    { rewindKind: WireRewindKind.conversation, forkFrom: "2026-06-01T14:30:00Z", rejoinAt: "2026-06-03T18:20:00Z",
      nodes: [{ at: "2026-06-02T09:00:00Z", label: "reword ask" }, { at: "2026-06-02T11:00:00Z", label: "refine ask" }] },
    { rewindKind: WireRewindKind.code, forkFrom: "2026-06-03T18:20:00Z",
      nodes: [{ at: "2026-06-05T10:00:00Z", label: "try split" }, { at: "2026-06-05T12:00:00Z", label: "tune split" }] },
  ],
};

// Every branch node instant, branch after branch, in node order.
export function listMockBranchInstants(path: Path): Date[] {
  return (EMBEDDED_MOCK_BRANCHES[path.toString()] ?? []).flatMap((spec) => spec.nodes.map((node) => new Date(parseMs(node.at))));
}

// tailOffsetsPx holds the node offsets laid out after the trunk ladder, in listMockBranchInstants order.
export function buildMockBranchesField(path: Path, tailOffsetsPx: number[]): Pick<Layer1WirePair, "branches"> {
  const specs = EMBEDDED_MOCK_BRANCHES[path.toString()];
  if (specs === undefined) {
    return {};
  }
  let nextOffset = 0;
  const takeOffset = (): number => {
    const offset = tailOffsetsPx[nextOffset];
    if (offset === undefined) {
      throw new Error(`no laid-out offset for branch node ${nextOffset} of ${path.toString()}`);
    }
    nextOffset += 1;
    return offset;
  };
  return {
    branches: specs.map((spec) => ({
      rewindKind: spec.rewindKind,
      forkFrom: new Date(parseMs(spec.forkFrom)),
      ...(spec.rejoinAt === undefined ? {} : { rejoinAt: new Date(parseMs(spec.rejoinAt)) }),
      nodes: spec.nodes.map((node) => ({ instant: new Date(parseMs(node.at)), axisPx: takeOffset(), label: node.label })),
    })),
  };
}
*/
