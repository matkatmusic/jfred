// The status texts of the terminal UI walker: what a stop or a crash says.

import { basename } from "node:path";
import { FileEventType } from "../engineV3_replay_reverse_events.ts";
import { StepProcessOutcomeKind } from "../../src/structures/vocabulary.ts";
import type { StepProcessOutcome } from "./engineV3_tui_walk_types.ts";

export function formatShortSource(source: string | null): string {
    return basename(String(source));
}

export function describeCrash(outcome: Extract<StepProcessOutcome, { kind: StepProcessOutcomeKind.Crashed }>): string {
    let crashText = `process killed by signal ${outcome.signal}`;
    if (outcome.exitCode !== null) {
        crashText = `process exited with code ${outcome.exitCode}`;
    }
    if (outcome.crashedAt !== null) {
        crashText += ` at ${outcome.crashedAt.eventType} ${outcome.crashedAt.source}`;
    }
    return `${crashText}: ${outcome.stderrTail}`;
}

export function describeRefusedStop(eventType: FileEventType, source: string | null): string {
    if (eventType === FileEventType.ScriptMayWrite) {
        return `stopped at ${FileEventType.ScriptMayWrite} ${formatShortSource(source)}: scripts are not allowed in this session`;
    }
    return `stopped at ${eventType} ${formatShortSource(source)}: the engine stops here in every new process`;
}
