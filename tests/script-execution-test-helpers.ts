import { PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX } from "../src/reconstruction_script_sandbox.ts";
import { setReconstructionProgressSink } from "../src/reconstruction_progress.ts";
import { BlockType, RecordType, ToolName } from "../src/structures/vocabulary.ts";
import type { TranscriptRecord } from "../src/structures/envelope.ts";
import { Path } from "../src/structures/domain.ts";

// A synthetic assistant record carrying one tool_use of `name` with `input`, at `timestamp`, with the record-level `cwd` transcripts carry.
export function buildToolRecord(
    name: ToolName,
    input: Record<string, unknown>,
    timestamp: string,
    cwd?: string,
): TranscriptRecord {
    return {
        type: RecordType.assistant,
        timestamp: new Date(timestamp),
        cwd: cwd !== undefined ? new Path(cwd) : undefined,
        message: { content: [{ type: BlockType.tool_use, id: "toolu_x", name, input, caller: { type: "direct" } }] },
    } as unknown as TranscriptRecord;
}

// Collect sandbox-SPAWN announcements while `action` runs (memo hits announce differently).
export function collectSandboxSpawnLabels(action: () => void): string[] {
    const spawnLabels: string[] = [];
    setReconstructionProgressSink((event) => {
        if (event.label.startsWith(PROGRESS_LABEL_SANDBOX_SPAWN_PREFIX)) {
            spawnLabels.push(event.label);
        }
    });
    try {
        action();
    } finally {
        setReconstructionProgressSink(undefined);
    }
    return spawnLabels;
}
