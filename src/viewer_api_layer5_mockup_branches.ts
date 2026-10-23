// Task 379 mockup-only: canned forked lanes for two fixture bubbles; the real branches replace this after sign-off (S25).

import type { Path } from "./structures/domain.ts";
import { WireRewindKind } from "../webapp/layer1-wire.ts";
import type { Layer1WirePair } from "./viewer_api_layer1.ts";
import { parseMs } from "./viewer_api_layer1_fixture_data.ts";

interface MockBranchSpec {
  rewindKind: WireRewindKind;
  forkFrom: string;
  rejoinAt?: string;
  nodes: { at: string; label: string }[];
}

// fork/rejoin equal existing trunk commit instants; every node instant is unused by that file's other fixture nodes.
const MOCK_BRANCHES: Record<string, MockBranchSpec[]> = {
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
  return (MOCK_BRANCHES[path.toString()] ?? []).flatMap((spec) => spec.nodes.map((node) => new Date(parseMs(node.at))));
}

// tailOffsetsPx holds the node offsets laid out after the trunk ladder, in listMockBranchInstants order.
export function buildMockBranchesField(path: Path, tailOffsetsPx: number[]): Pick<Layer1WirePair, "branches"> {
  const specs = MOCK_BRANCHES[path.toString()];
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
