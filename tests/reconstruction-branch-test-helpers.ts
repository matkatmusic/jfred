import { RecordType } from "../src/structures/vocabulary.ts";
import { Uuid } from "../src/structures/domain.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";

export function rec(type: RecordType, uuid: string, parent: string | null, blocks?: unknown[]): TranscriptRecord {
    return {
        type,
        uuid: new Uuid(uuid),
        parentUuid: parent === null ? null : new Uuid(parent),
        ...(blocks !== undefined ? { message: { content: blocks } } : {}),
    } as TranscriptRecord;
}
export function lastPrompt(leaf: string): TranscriptRecord {
    return { type: RecordType.lastPrompt, leafUuid: leaf } as unknown as TranscriptRecord;
}
