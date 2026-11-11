// Rules for the recorded Bash calls the replay skips because they run only on the Mac, and the files that stand in for them.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import { executeGit } from "./engineV3.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";
import { getProgramName, getProgramWords, isEveryRedirectDiscarded, isSegmentReadOnly, parseShellCommand, type ShellSegment } from "./engineV3_replay_script_internet.ts";

export type MacOnlyFill = { toolUseId: Uuid; repoPath: Path; commit: string };

const SIPS_WORD = /\bsips\b/;
// The program path with its closing quote: a run or a C="..." variable holds it, a plain ls of the folder does not.
const CHROME_PROGRAM_TEXT = 'MacOS/Google Chrome"';
// Every recorded run of a Chrome script file is a bun run.
const SCRIPT_RUNNER_PROGRAM = "bun";
const CHROME_NAME_TEXT = "Google Chrome";
const MAC_APPLICATIONS_FOLDER_TEXT = "/Applications/";
const MAC_PROGRAM_FOLDER_TEXT = "MacOS/";
const VARIABLE_ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/s;

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

function isMacOnlyScriptText(scriptText: string): boolean {
  if (scriptText.includes(CHROME_NAME_TEXT)) {
    return true;
  }
  if (!scriptText.includes(MAC_APPLICATIONS_FOLDER_TEXT)) {
    return false;
  }
  return scriptText.includes(MAC_PROGRAM_FOLDER_TEXT);
}

// Only the $NAME and ${NAME} forms of variables set earlier in the same command are replaced.
function expandShellVariables(word: string, variables: Map<string, string>): string {
  let expandedWord = word;
  for (const [name, value] of variables) {
    expandedWord = expandedWord.split(`\${${name}}`).join(value);
    expandedWord = expandedWord.replace(new RegExp(`\\$${name}(?!\\w)`, "g"), () => value);
  }
  return expandedWord;
}

// A simple command made only of NAME=value words sets shell variables for the rest of the command.
function recordShellVariables(segment: ShellSegment, variables: Map<string, string>): void {
  const programWords = getProgramWords(segment);
  if (programWords.length > 0) {
    return;
  }
  for (const word of segment.words) {
    const assignment = VARIABLE_ASSIGNMENT.exec(word);
    if (assignment !== null) {
      variables.set(assignment[1]!, expandShellVariables(assignment[2]!, variables));
    }
  }
}

// The replay already wrote the script file into the container, at the path the command names.
function isMacOnlyScriptRun(segment: ShellSegment, variables: Map<string, string>, cwd: Path): boolean {
  if (!isEveryRedirectDiscarded(segment)) {
    return false;
  }
  const programWords = getProgramWords(segment);
  if (getProgramName(programWords) !== SCRIPT_RUNNER_PROGRAM) {
    return false;
  }
  const scriptWord = programWords[1];
  if (scriptWord === undefined) {
    return false;
  }
  const expandedScriptWord = expandShellVariables(scriptWord, variables);
  let scriptPath = expandedScriptWord;
  if (!isAbsolute(expandedScriptWord)) {
    scriptPath = join(cwd.toString(), expandedScriptWord);
  }
  if (!existsSync(scriptPath)) {
    return false;
  }
  if (!statSync(scriptPath).isFile()) {
    return false;
  }
  return isMacOnlyScriptText(readFileSync(scriptPath, "utf8"));
}

// Skipping drops the whole call, so every other simple command in it must change no file.
export function isMacOnlyScriptCommand(command: string, cwd: Path): boolean {
  const parsed = parseShellCommand(command);
  if (parsed.hasUncheckedText) {
    return false;
  }
  const variables = new Map<string, string>();
  let runsMacOnlyScript = false;
  for (const segment of parsed.segments) {
    recordShellVariables(segment, variables);
    if (isMacOnlyScriptRun(segment, variables, cwd)) {
      runsMacOnlyScript = true;
      continue;
    }
    if (!isSegmentReadOnly(segment)) {
      return false;
    }
  }
  return runsMacOnlyScript;
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
