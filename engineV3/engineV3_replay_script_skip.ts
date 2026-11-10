// Rules for the recorded Bash calls the replay skips because they run only on the Mac, and the files that stand in for them.

import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";

export type MacOnlyFill = { toolUseId: Uuid; repoPath: Path; commit: string };

const SIPS_WORD = /\bsips\b/;
// The program path with its closing quote: a run or a C="..." variable holds it, a plain ls of the folder does not.
const CHROME_PROGRAM_TEXT = 'MacOS/Google Chrome"';

// The skipped call copied a cropped picture into docs/report.png; commit 9becb03 has that picture.
export const MAC_ONLY_FILLS: MacOnlyFill[] = [
  { toolUseId: new Uuid("toolu_01MCSxEwsbVK6FgSQZMCN8Jp"), repoPath: new Path("docs/report.png"), commit: "9becb03" },
];

export function isMacOnlyCommand(command: string): boolean {
  if (SIPS_WORD.test(command)) {
    return true;
  }
  return command.includes(CHROME_PROGRAM_TEXT);
}

export function fillMacOnlyFile(state: Path, fill: MacOnlyFill, sourceRepo: Path): void {
  const bytes = executeGit(sourceRepo, ["show", `${fill.commit}:${fill.repoPath.toString()}`]);
  writeFileIntoState(state, fill.repoPath, bytes);
}

export function fillMacOnlyFiles(state: Path, toolUseId: Uuid, sourceRepo: Path): void {
  for (const fill of MAC_ONLY_FILLS) {
    const isFillOfThisCall = fill.toolUseId.equals(toolUseId);
    if (isFillOfThisCall) {
      fillMacOnlyFile(state, fill, sourceRepo);
    }
  }
}
