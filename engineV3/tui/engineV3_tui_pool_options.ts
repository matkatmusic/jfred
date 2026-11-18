// Checks the options of the step pool.

import type { StepPoolOptions } from "./engineV3_tui_walk_types.ts";

const MAXIMUM_PROCESSES_ALLOWED = 4;

export function validateStepPoolOptions(options: StepPoolOptions): void {
    if (options.maxProcesses > MAXIMUM_PROCESSES_ALLOWED) {
        throw new Error(`maxProcesses ${options.maxProcesses} is above the limit of ${MAXIMUM_PROCESSES_ALLOWED}`);
    }
    if (options.maxProcesses < 1) {
        throw new Error(`maxProcesses ${options.maxProcesses} is below 1`);
    }
}
