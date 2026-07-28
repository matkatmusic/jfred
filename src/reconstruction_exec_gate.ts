// Gate for impure stages (script re-execution, git shell-outs).
// ponytail: process-wide switch, not per-call threading — builds are synchronous and the server serializes them; thread an options object through reconstruct* if that changes.
let impureExecutionAllowed = true;

export function setImpureExecutionAllowed(allowed: boolean): void {
    impureExecutionAllowed = allowed;
}

export function isImpureExecutionAllowed(): boolean {
    return impureExecutionAllowed;
}

