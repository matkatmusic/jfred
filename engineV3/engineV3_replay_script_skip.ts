// Rules for the recorded Bash calls the replay skips because they run only on the Mac, and the files that stand in for them.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
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

// A script file may quote the program path with single or double quotes, so no closing quote is part of the needle.
const CHROME_PROGRAM_PATH = "MacOS/Google Chrome";
// `cd <folder> && [timeout N] bun <script>`: the script file holds the Chrome program path, not the command.
const CD_THEN_SCRIPT = /cd\s+(\S+)\s*&&\s*(?:timeout\s+\d+\s+)?(?:bun|node|tsx)\s+(?:run\s+)?(\S+\.(?:ts|js|mjs))/;
export function isMacOnlyScriptRun(run: ScriptRun): boolean {
  const match = CD_THEN_SCRIPT.exec(run.code);
  if (match === null) {
    return false;
  }
  if (run.cwd === undefined) {
    throw new Error(`isMacOnlyScriptRun: the Bash call has no cwd\ncommand: ${run.code}`);
  }
  const scriptFile = resolve(run.cwd.toString(), (match[1] as string).replace(/^["']|["']$/g, ""), match[2] as string);
  if (!existsSync(scriptFile)) {
    return false;
  }
  return readFileSync(scriptFile, "utf8").includes(CHROME_PROGRAM_PATH);
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
