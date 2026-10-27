// Branch record selection: a tip's ancestor chain, memoized per records-array identity.

import type { TranscriptRecord } from "./structures/envelope.ts";
import type { Uuid } from "./structures/domain.ts";
import { collectAncestorUuids } from "./reconstruction_tree.ts";
import { getCorpusState } from "./reconstruction_corpus.ts";

// Branch selections memoized per records-array identity. Downstream caches (executeRunOnce's
// per-array script memo, reconstructFileOver's history memo) key on the records array's IDENTITY;
// re-filtering a fresh array for the same (records, tip) on every call silently defeated them,
// so every document pass re-ran every sandbox script. Same inputs → the same array instance.
// corpus: moved to reconstruction_corpus.ts (item 14)
// const branchSelections = new WeakMap<TranscriptRecord[], Map<string, TranscriptRecord[]>>();

// Selects tip's ancestor chain plus uuid-less meta records; falls back to all records.
export function selectBranchRecords(
  records: TranscriptRecord[],
  tip: Uuid,
): TranscriptRecord[] {
  // corpus: moved to reconstruction_corpus.ts (item 14)
  // let byTip = branchSelections.get(records);
  // if (byTip === undefined) {
  //     byTip = new Map<string, TranscriptRecord[]>();
  //     branchSelections.set(records, byTip);
  // }
  const byTip = getCorpusState(records).branchSelectionsByTip;
  const tipKey = tip.toString();
  const cached = byTip.get(tipKey);
  if (cached !== undefined) {
    return cached;
  }
  const selected = computeBranchRecords(records, tip);
  byTip.set(tipKey, selected);
  return selected;
}

function computeBranchRecords(
  records: TranscriptRecord[],
  tip: Uuid,
): TranscriptRecord[] {
  const branchUuids = collectAncestorUuids(records, tip);
  if (branchUuids.size === 0) {
    return records;
  }
  const selected = records.filter(
    (record) => record.uuid === undefined || branchUuids.has(record.uuid.toString()),
  );
    // Nothing dropped: keep the input's identity so downstream identity-keyed memos hit.
  if (selected.length === records.length) {
    return records;
  }
  return selected;
}
