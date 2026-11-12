// Rules for the recorded Bash calls the replay skips because they run only on the Mac, and the files that stand in for them.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { executeGit } from "./engineV3.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";

// destinationPath is an absolute path (a scratchpad picture); without it the file goes to repoPath in the state.
export type MacOnlyFill = { toolUseId: Uuid; repoPath: Path; commit: string; destinationPath?: Path };

const SIPS_WORD = /\bsips\b/;
// The program path with its closing quote: a run or a C="..." variable holds it, a plain ls of the folder does not.
const CHROME_PROGRAM_TEXT = 'MacOS/Google Chrome"';

const SCRATCHPAD_2D04358E = "/private/tmp/claude-501/-Users-matkatmusicllc-Programming-typesafe-playground/2d04358e-e99b-4a40-8519-409322d4bc8c/scratchpad";

// The skipped call copied a cropped picture into docs/report.png; commit 9becb03 has that picture.
export const MAC_ONLY_FILLS: MacOnlyFill[] = [
  { toolUseId: new Uuid("toolu_01MCSxEwsbVK6FgSQZMCN8Jp"), repoPath: new Path("docs/report.png"), commit: "9becb03" },
  // agent-a692f025ba883a3cd.jsonl line 199 (shoot.mjs all) made out/*.png; line 252 copied them into docs/; commit 7e3103b is the first to hold them.
  { toolUseId: new Uuid("toolu_014rZBh3XsArPUYXtGPk1zwV"), repoPath: new Path("docs/playground-graphs.png"), commit: "7e3103b", destinationPath: new Path(`${SCRATCHPAD_2D04358E}/out/playground-graphs.png`) },
  { toolUseId: new Uuid("toolu_014rZBh3XsArPUYXtGPk1zwV"), repoPath: new Path("docs/backtick-tooltip.png"), commit: "7e3103b", destinationPath: new Path(`${SCRATCHPAD_2D04358E}/out/backtick-tooltip.png`) },
  { toolUseId: new Uuid("toolu_014rZBh3XsArPUYXtGPk1zwV"), repoPath: new Path("docs/undefined-name-squiggle.png"), commit: "7e3103b", destinationPath: new Path(`${SCRATCHPAD_2D04358E}/out/undefined-name-squiggle.png`) },
  { toolUseId: new Uuid("toolu_014rZBh3XsArPUYXtGPk1zwV"), repoPath: new Path("docs/notes-dialog.png"), commit: "7e3103b", destinationPath: new Path(`${SCRATCHPAD_2D04358E}/out/notes-dialog.png`) },
  // line 229 (shoot.mjs report) remade out/report.png after line 199; line 252 copied it; commit 7e3103b.
  { toolUseId: new Uuid("toolu_0189ZDHPTy3nsjtT3dyZCgz8"), repoPath: new Path("docs/report.png"), commit: "7e3103b", destinationPath: new Path(`${SCRATCHPAD_2D04358E}/out/report.png`) },
  // agent-aa04106c8774e7d6e.jsonl line 275 (report3.mjs 1400 1130) made report3.png; line 287 copied it to docs/report.png; commit 6b740d8.
  { toolUseId: new Uuid("toolu_01HygvHAbJuLiLcEeWb1fA9p"), repoPath: new Path("docs/report.png"), commit: "6b740d8", destinationPath: new Path(`${SCRATCHPAD_2D04358E}/report3.png`) },
];

export function isMacOnlyCommand(command: string): boolean {
  if (SIPS_WORD.test(command)) {
    return true;
  }
  return command.includes(CHROME_PROGRAM_TEXT);
}

// A script file may quote the program path with single or double quotes, so no closing quote is part of the needle.
const CHROME_PROGRAM_PATH = "MacOS/Google Chrome";
// The playwright headless shell the Mac screenshot scripts name in their executablePath.
const MAC_HEADLESS_SHELL_FOLDER = "chrome-headless-shell-mac-arm64";
const MAC_ONLY_SCRIPT_NEEDLES = [CHROME_PROGRAM_PATH, MAC_HEADLESS_SHELL_FOLDER];
// `cd <folder> (&& or ;) [timeout N] bun <script>`: the script file holds the Chrome program path, not the command.
const CD_THEN_SCRIPT = /cd\s+(\S+?)\s*(?:&&|;)\s*(?:timeout\s+\d+\s+)?(?:bun|node|tsx)\s+(?:run\s+)?(\S+\.(?:ts|js|mjs))/;
const VARIABLE_ASSIGNMENT = /(?<=^|;)\s*([A-Za-z_][A-Za-z0-9_]*)=([^\s;]+)(?=\s*;)/g;
// The cd folder may name a variable the same command sets first: `SP=/tmp/x; cd $SP/shotscript; bun report3.mjs`. A variable the command does not set stays as text, so no script file is found.
function expandAssignedVariables(folder: string, command: string): string {
  const assignedValues = new Map<string, string>();
  for (const assignment of command.matchAll(VARIABLE_ASSIGNMENT)) {
    assignedValues.set(assignment[1] as string, assignment[2] as string);
  }
  return folder.replace(/\$(\w+)/g, (variableText, name: string) => assignedValues.get(name) ?? variableText);
}
export function isMacOnlyScriptRun(run: ScriptRun): boolean {
  const match = CD_THEN_SCRIPT.exec(run.code);
  if (match === null) {
    return false;
  }
  if (run.cwd === undefined) {
    throw new Error(`isMacOnlyScriptRun: the Bash call has no cwd\ncommand: ${run.code}`);
  }
  const folder = expandAssignedVariables((match[1] as string).replace(/^["']|["']$/g, ""), run.code);
  const scriptFile = resolve(run.cwd.toString(), folder, match[2] as string);
  if (!existsSync(scriptFile)) {
    return false;
  }
  const scriptText = readFileSync(scriptFile, "utf8");
  return MAC_ONLY_SCRIPT_NEEDLES.some((needle) => scriptText.includes(needle));
}
export function fillMacOnlyFile(state: Path, fill: MacOnlyFill, sourceRepo: Path): void {
  const bytes = executeGit(sourceRepo, ["show", `${fill.commit}:${fill.repoPath.toString()}`]);
  if (fill.destinationPath === undefined) {
    writeFileIntoState(state, fill.repoPath, bytes);
    return;
  }
  writeFileIntoState(new Path("/"), fill.destinationPath, bytes);
}

export function fillMacOnlyFiles(state: Path, toolUseId: Uuid, sourceRepo: Path): void {
  for (const fill of MAC_ONLY_FILLS) {
    const isFillOfThisCall = fill.toolUseId.equals(toolUseId);
    if (isFillOfThisCall) {
      fillMacOnlyFile(state, fill, sourceRepo);
    }
  }
}
