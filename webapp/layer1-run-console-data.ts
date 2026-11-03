// L6 run console mockup data (ported from plans/l6-console-mockup/fixture.js): static text, no timers.

export const RUN_CONSOLE_OUTPUT_LINES: readonly string[] = [
  "$ python3 migrate_users.py --batch 200",
  "Loading schema v14...",
  "Connected to shard 3 of 6",
  "Processing batch 1/40 (200 rows)",
  "  200 rows OK, 0 skipped",
  "Processing batch 2/40 (200 rows)",
  "  200 rows OK, 0 skipped",
  "Processing batch 3/40 (200 rows)",
  "  198 rows OK, 2 skipped (duplicate key)",
  "Processing batch 4/40 (200 rows)",
  "Processing batch 5/40",
];

export const RUN_CONSOLE_STREAMING_CAPTION =
  "In the real console this block grows line by line as the script prints to stdout; here it is " +
  "a fixed snapshot of output already streamed, not an animation.";

export interface RunConsoleCancelState {
  readonly key: string;
  readonly label: string;
  readonly className: string;
  readonly disabled: boolean;
}

export const RUN_CONSOLE_CANCEL_STATES: readonly RunConsoleCancelState[] = [
  { key: "idle", label: "Cancel", className: "btn-idle", disabled: true },
  { key: "running-cancelable", label: "Cancel", className: "btn-live", disabled: false },
  { key: "cancelled", label: "Cancelled", className: "btn-cancelled", disabled: true },
];

export interface RunConsoleTerminalState {
  readonly key: string;
  readonly label: string;
  readonly className: string;
  readonly description: string;
}

export const RUN_CONSOLE_TERMINAL_STATES: readonly RunConsoleTerminalState[] = [
  {
    key: "cancelled",
    label: "Cancelled",
    className: "term-cancelled",
    description: "Run stopped by the user before it produced a result.",
  },
  {
    key: "verified",
    label: "Verified",
    className: "term-verified",
    description: "Replay output matches the expected post-run state.",
  },
  {
    key: "mismatch",
    label: "Mismatch",
    className: "term-mismatch",
    description: "Replay output differs from the expected post-run state.",
  },
  {
    key: "original-failed",
    label: "Original run failed",
    className: "term-original-failed",
    description: "The recorded run itself errored; it was never replayed.",
  },
];
