// One console line per engine startup phase, and progress lines while a slow phase runs, so a long start does not look hung.

export type ReportPhaseProgress = (doneCount: number, totalCount: number) => void;
export type ReadNow = () => Date;
export type PrintLine = (line: string) => void;

const PROGRESS_INTERVAL_MILLISECONDS = 10000;

function readSystemNow(): Date {
  return new Date();
}

function printToConsole(line: string): void {
  console.log(line);
}

// A progress line prints at most once per 10 seconds; the phase calls reportProgress once per item.
export function runStartupPhase<Result>(phaseName: string, runPhase: (reportProgress: ReportPhaseProgress) => Result, describeResult: (result: Result) => string, readNow: ReadNow = readSystemNow, printLine: PrintLine = printToConsole): Result {
  const startTime = readNow();
  let lastPrintTime = startTime;
  const reportProgress: ReportPhaseProgress = (doneCount, totalCount) => {
    const now = readNow();
    const millisecondsSinceLastPrint = now.getTime() - lastPrintTime.getTime();
    if (millisecondsSinceLastPrint >= PROGRESS_INTERVAL_MILLISECONDS) {
      lastPrintTime = now;
      printLine(`${now.toISOString()} startup: ${phaseName} ${doneCount}/${totalCount}`);
    }
  };
  const result = runPhase(reportProgress);
  const endTime = readNow();
  const seconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
  printLine(`${endTime.toISOString()} startup: ${describeResult(result)} in ${seconds}s`);
  return result;
}

// For a phase with no item loop to report from.
export function ignorePhaseProgress(_doneCount: number, _totalCount: number): void {}
