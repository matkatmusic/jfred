// Genuine typed-in user prompts and the parentUuid fork points they reveal. Split out of
// reconstruction_tree.ts (250-line cap): tree walkers stay there; prompt classification and
// prompt-fork detection live here. See plans/s13/s13-reconstruction-plan.md.

import type { TranscriptRecord } from "./structures/envelope.ts";
import { getContentBlocks } from "./structures/content-blocks.ts";
import { BlockType, RecordType } from "./structures/vocabulary.ts";
import { Uuid } from "./structures/domain.ts";

// True when `record` is a genuine typed-in user prompt: a `user` record that is not isMeta machinery
// and carries no tool_result block. This rejects tool-result `user` records (e.g. a Write result) and
// /exit caveats, so only real prompts count as fork children. See plans/s13/s13-reconstruction-plan.md.
export function isGenuineUserPrompt(record: TranscriptRecord): boolean {
    if (record.type !== RecordType.user) {
        return false;
    }
    if (record.origin?.kind === "human") {
        return true;
    }
    if (record.isMeta === true) {
        return false;
    }
    for (const block of getContentBlocks(record)) {
        if (block.type === BlockType.tool_result) {
            return false;
        }
    }
    return true;
}

// The parentUuid strings that parent ≥2 genuine user prompts, in first-appearance order. Each is a
// rewind fork point: a rewind that re-prompts from a point makes that point the shared parent of both
// the abandoned and the surviving prompt. Children of other kinds (attachments, tool-result `user`
// records) do not count — only isGenuineUserPrompt children. See plans/s13/s13-reconstruction-plan.md.
export function findPromptForkPoints(records: TranscriptRecord[]): Uuid[] {
    const promptParents = new Map<string, { parent: Uuid; count: number }>();
    const order: string[] = [];
    for (const record of records) {
        if (!isGenuineUserPrompt(record)) {
            continue;
        }
        const parent = record.parentUuid;
        if (parent === undefined || parent === null) {
            continue;
        }
        const key = parent.toString();
        const existing = promptParents.get(key);
        if (existing === undefined) {
            promptParents.set(key, { parent, count: 1 });
            order.push(key);
            continue;
        }
        existing.count += 1;
    }
    const orderedEntries = order.map((key) => promptParents.get(key)!);
    const forkEntries = orderedEntries.filter((entry) => entry.count >= 2);
    const forkParents = forkEntries.map((entry) => entry.parent);
    return forkParents;
}
