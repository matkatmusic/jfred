// Fixture self-check for one Edit event's structuredPatch hunks.

import type { FixtureEvent } from "./viewer_api_layer3_fixture_data.ts";

interface HunkRowCounts { oldRows: number; newRows: number; unprefixed: number; }

function countHunkRows(lines: string[]): HunkRowCounts {
  const counts = { oldRows: 0, newRows: 0, unprefixed: 0 };
  for (const row of lines) {
    const isContext = row.startsWith(" ");
    const isRemoved = row.startsWith("-");
    const isAdded = row.startsWith("+");
    const isOldRow = isContext || isRemoved;
    const isNewRow = isContext || isAdded;
    const isUnprefixed = !isOldRow && !isAdded;
    if (isOldRow) {
      counts.oldRows += 1;
    }
    if (isNewRow) {
      counts.newRows += 1;
    }
    if (isUnprefixed) {
      counts.unprefixed += 1;
    }
  }
  return counts;
}

export function listHunkProblems(where: string, event: FixtureEvent): string[] {
  const hunks = event.hunks ?? [];
  if (hunks.length === 0) {
    return [`${where}: an edit has no hunks`];
  }
  const problems: string[] = [];
  for (const hunk of hunks) {
    const counts = countHunkRows(hunk.lines);
    const areCountsWrong = hunk.oldLines !== counts.oldRows || hunk.newLines !== counts.newRows;
    const isStartWrong = hunk.oldStart < 1 || hunk.newStart < 1;
    if (areCountsWrong) {
      problems.push(`${where}: hunk counts ${hunk.oldLines}/${hunk.newLines} disagree with its rows ${counts.oldRows}/${counts.newRows}`);
    }
    if (isStartWrong) {
      problems.push(`${where}: hunk starts at line ${hunk.oldStart}/${hunk.newStart}`);
    }
    if (counts.unprefixed > 0) {
      problems.push(`${where}: ${counts.unprefixed} hunk rows have no + - or space prefix`);
    }
  }
  return problems;
}
