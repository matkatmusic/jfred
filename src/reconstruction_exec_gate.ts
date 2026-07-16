// Consent gate for the two impure reconstruction stages (script re-execution and git
// shell-outs). Defaults ON so the CLI, tests, and coverage behave exactly as before;
// the viewer server boots it OFF and enables it only for a consented build.
// ponytail: process-wide switch, not per-call threading — builds are synchronous and the
// server serializes them; thread an options object through reconstruct* if that changes.
let impureExecutionAllowed = true;

export function setImpureExecutionAllowed(allowed: boolean): void {
    impureExecutionAllowed = allowed;
}

export function isImpureExecutionAllowed(): boolean {
    return impureExecutionAllowed;
}

