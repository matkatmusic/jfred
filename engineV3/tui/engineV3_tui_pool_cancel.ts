// Cancel steps of the step pool: one file, or every file.

import type { Path } from "../../src/structures/domain.ts";
import { FileWalkStatus } from "../../src/structures/vocabulary.ts";
import type { PoolEntry } from "./engineV3_tui_pool_queue.ts";
import type { StepPoolOptions, StepRequest } from "./engineV3_tui_walk_types.ts";

export interface PoolCancelContext {
    queueByFileValue: Map<string, PoolEntry>;
    pendingByFileValue: Map<string, PoolEntry>;
    runningRequestByFileValue: Map<string, StepRequest>;
    cancelledFileValues: Set<string>;
    setStatus: (file: Path, status: FileWalkStatus) => void;
    options: StepPoolOptions;
}

export async function cancelFile(context: PoolCancelContext, file: Path): Promise<void> {
    const fileValue = file.value;
    context.pendingByFileValue.delete(fileValue);
    if (context.queueByFileValue.delete(fileValue)) {
        context.setStatus(file, FileWalkStatus.Idle);
    }
    if (context.runningRequestByFileValue.has(fileValue)) {
        context.cancelledFileValues.add(fileValue);
    }
    await context.options.endChildOfFile(file);
}

export async function cancelAll(context: PoolCancelContext): Promise<void> {
    for (const fileValue of context.runningRequestByFileValue.keys()) {
        context.cancelledFileValues.add(fileValue);
    }
    for (const entry of context.queueByFileValue.values()) {
        context.setStatus(entry.request.file, FileWalkStatus.Idle);
    }
    context.queueByFileValue.clear();
    context.pendingByFileValue.clear();
    await context.options.endAllChildren();
}
