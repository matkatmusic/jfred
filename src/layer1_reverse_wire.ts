// The engine's reverse walk of one file shaped into the /api/layer1-reverse wire view.

import { ReverseStateKind, type ReverseFileState } from "../engineV3/engineV3_replay_reverse.ts";
import { WireReverseKind, type WireReverseStateOf, type WireReverseWalkOf } from "../webapp/layer1-wire-reverse.ts";
import { Path } from "./structures/domain.ts";

export type Layer1WireReverseWalk = WireReverseWalkOf<Date, Path>;

function convertReverseKindToWireKind(kind: ReverseStateKind): WireReverseKind {
  switch (kind) {
    case ReverseStateKind.DiskNow:
      return WireReverseKind.DiskNow;
    case ReverseStateKind.EditUndone:
      return WireReverseKind.EditUndone;
    case ReverseStateKind.WriteUndone:
      return WireReverseKind.WriteUndone;
    case ReverseStateKind.FileCreated:
      return WireReverseKind.FileCreated;
    case ReverseStateKind.UnknownChange:
      return WireReverseKind.UnknownChange;
    case ReverseStateKind.ScriptChange:
      return WireReverseKind.ScriptChange;
    case ReverseStateKind.GitCommit:
      return WireReverseKind.GitCommit;
    case ReverseStateKind.BackupSnapshot:
      return WireReverseKind.BackupSnapshot;
    case ReverseStateKind.ReadOnly:
      return WireReverseKind.ReadOnly;
    case ReverseStateKind.PossibleChange:
      return WireReverseKind.PossibleChange;
    default:
      throw new Error(`unknown reverse state kind: ${String(kind)}`);
  }
}

function buildReverseStateWire(state: ReverseFileState): WireReverseStateOf<Date, Path> {
  const wireState: WireReverseStateOf<Date, Path> = { index: state.index, kind: convertReverseKindToWireKind(state.kind), isModifying: state.isModifying };
  if (state.timestamp !== undefined) {
    wireState.instant = state.timestamp;
  }
  if (state.content !== undefined) {
    wireState.content = state.content;
  }
  if (state.jsonlPath !== undefined) {
    wireState.jsonlPath = state.jsonlPath;
  }
  if (state.lineNumber !== undefined) {
    wireState.lineNumber = state.lineNumber;
  }
  if (state.commitHash !== undefined) {
    wireState.commitHash = state.commitHash.toString();
  }
  return wireState;
}

export function buildReverseWalkWire(path: string, states: ReverseFileState[]): Layer1WireReverseWalk {
  return { path, states: states.map(buildReverseStateWire) };
}
