// Gate for impure stages (script re-execution, git shell-outs).
// ponytail: process-wide switch, not per-call threading; builds are synchronous. Scoped turn-on: executeWithImpureExecution.
let impureExecutionAllowed = true;

export function setImpureExecutionAllowed(allowed: boolean): void {
  impureExecutionAllowed = allowed;
}

export function isImpureExecutionAllowed(): boolean {
  return impureExecutionAllowed;
}

// Turns the gate on for one synchronous block and always restores the old value.
export function executeWithImpureExecution<T>(compute: () => T): T {
  const previous = isImpureExecutionAllowed();
  setImpureExecutionAllowed(true);
  try {
    return compute();
  }
  finally {
    setImpureExecutionAllowed(previous);
  }
}
