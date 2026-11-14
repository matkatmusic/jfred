// Rules for the recorded Bash calls the replay skips because they run only on the Mac, and the files that stand in for them.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { Path, Uuid } from "../src/structures/domain.ts";
import type { ScriptRun } from "../src/reconstruction_script_execution.ts";
import { executeGit } from "./engineV3.ts";
import { writeFileIntoState } from "./engineV3_replay_submodule.ts";
import { getProgramName, getProgramWords, isEveryRedirectDiscarded, isSegmentReadOnly, parseShellCommand, type ShellSegment } from "./engineV3_replay_script_internet.ts";

// destinationPath is an absolute path (a scratchpad picture); without it the file goes to repoPath in the state.
export type MacOnlyFill = { toolUseId: Uuid; repoPath: Path; commit: string; destinationPath?: Path };

const SIPS_WORD = /\bsips\b/;
// The program path with its closing quote: a run or a C="..." variable holds it, a plain ls of the folder does not.
const CHROME_PROGRAM_TEXT = 'MacOS/Google Chrome"';
// Every recorded run of a Chrome script file is a bun run.
const SCRIPT_RUNNER_PROGRAM = "bun";
const CHROME_NAME_TEXT = "Google Chrome";
const MAC_APPLICATIONS_FOLDER_TEXT = "/Applications/";
const MAC_PROGRAM_FOLDER_TEXT = "MacOS/";
const VARIABLE_ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/s;

const SCRATCHPAD_24366073 = "/private/tmp/claude-501/-Users-matkatmusicllc-Programming-typesafe-playground/24366073-dc22-42eb-a4fe-73006a20752f/scratchpad";
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
  // agent-ac894917bac015fa9.jsonl (session 24366073): shot.ts runs at lines 135-292 made report-new.png; the cp at line 263 and the cp at line 303 copied it into docs/report.png; commit a458d15 holds the final picture.
  { toolUseId: new Uuid("toolu_01Q4iavqiTRdi2JyrbBbDqAK"), repoPath: new Path("docs/report.png"), commit: "a458d15", destinationPath: new Path(`${SCRATCHPAD_24366073}/report-new.png`) },
  { toolUseId: new Uuid("toolu_01RdrCxapAehwcJuUvnpQhct"), repoPath: new Path("docs/report.png"), commit: "a458d15", destinationPath: new Path(`${SCRATCHPAD_24366073}/report-new.png`) },
];

// The Mac Chrome of agent-ac894917bac015fa9.jsonl (lines 114, 280) listened on port 47312; lines 126 (curl) and 135-292 (bun shot.ts <server port> 47312 report-new.png) talk to it. The pgrep at line 315 also names the port but runs with git worktree remove, so it is not matched.
const CHROME_DEBUG_PORT_CALL = /(?:127\.0\.0\.1|localhost):47312\b|\bshot\.ts\s+\d+\s+47312\b/;

// The Mac Chrome of agent-a1b06c9dba139ae95.jsonl (session 2fa36f95; lines 197, 302, 452) listened on port 9333; the curls to it (lines 201, 321) and the scratchpad drive.ts / drive2.ts runs (lines 201-229, 306-346, 462) talk to it. The pkill and pgrep at lines 235 and 351 only name the port in a pattern, so they are not matched.
const CHROME_DEBUG_PORT_9333_CALL = /(?:127\.0\.0\.1|localhost):9333\b|\bbun\s+drive2?\.ts\b/;

export function isMacOnlyCommand(command: string): boolean {
  if (SIPS_WORD.test(command)) {
    return true;
  }
  if (CHROME_DEBUG_PORT_CALL.test(command)) {
    return true;
  }
  if (CHROME_DEBUG_PORT_9333_CALL.test(command)) {
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
const CD_FOLDER_VARIABLE_ASSIGNMENT = /(?<=^|;)\s*([A-Za-z_][A-Za-z0-9_]*)=([^\s;]+)(?=\s*;)/g;
// The cd folder may name a variable the same command sets first: `SP=/tmp/x; cd $SP/shotscript; bun report3.mjs`. A variable the command does not set stays as text, so no script file is found.
function expandAssignedVariables(folder: string, command: string): string {
  const assignedValues = new Map<string, string>();
  for (const assignment of command.matchAll(CD_FOLDER_VARIABLE_ASSIGNMENT)) {
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

// The browser test skip rule below replaces the segment form of this check; the name now belongs to the exported ScriptRun check above.
// // The replay already wrote the script file into the container, at the path the command names.
// function isMacOnlyScriptRun(segment: ShellSegment, variables: Map<string, string>, cwd: Path): boolean {
//   if (!isEveryRedirectDiscarded(segment)) {
//     return false;
//   }
//   return isChromeScriptFileRun(segment, variables, cwd);
// }

function isChromeScriptFileRun(segment: ShellSegment, variables: Map<string, string>, cwd: Path): boolean {
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

// The browser test skip rule below replaces this one.
// // Skipping drops the whole call, so every other simple command in it must change no file.
// export function isMacOnlyScriptCommand(command: string, cwd: Path): boolean {
//   const parsed = parseShellCommand(command);
//   if (parsed.hasUncheckedText) {
//     return false;
//   }
//   const variables = new Map<string, string>();
//   let runsMacOnlyScript = false;
//   for (const segment of parsed.segments) {
//     recordShellVariables(segment, variables);
//     if (isMacOnlyScriptRun(segment, variables, cwd)) {
//       runsMacOnlyScript = true;
//       continue;
//     }
//     if (!isSegmentReadOnly(segment)) {
//       return false;
//     }
//   }
//   return runsMacOnlyScript;
// }

export type ReadScriptText = (scriptPath: string) => string | undefined;

type HeredocSplit = { commandText: string; heredocBodies: string[] };

// The Mac temp folders hold every session scratchpad and no project folder.
const OUTSIDE_PROJECT_FOLDER_STARTS = ["/private/tmp/", "/tmp/", "/var/folders/", "/private/var/folders/"];
const DISCARD_FILE = "/dev/null";
const BROWSER_TEXT = /Google Chrome|chromium|remote-debugging-port|--headless|playwright|puppeteer/i;
const BROWSER_PROGRAM_TEXT = /Google Chrome|chromium/i;
const BROWSER_SCRIPT_RUNNER_PROGRAMS = new Set(["bun", "node", "tsx"]);
const FILE_ARGUMENT_PROGRAMS = new Set(["mkdir", "touch", "rm"]);
const CHANGE_FOLDER_PROGRAM = "cd";
const HEREDOC_PROGRAM = "cat";
// Without a value these Chrome flags write into the current folder.
const CURRENT_FOLDER_FILE_FLAGS = new Set(["--screenshot", "--print-to-pdf"]);
const HEREDOC_START = /<<(-?)\s*(['"]?)(\w+)\2/;
const HERE_STRING_TEXT = "<<<";
const HEREDOC_WORD = "__engineV3_heredoc__";
const UNRESOLVED_PATH_TEXT = /[$~*?`]/;
const URL_START = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;
// A parenthesis that is not a $( ): with a subshell the cd of one part may not reach the next part.
const SUBSHELL_START = /(^|[^$])\(/;
const MAC_HOME_FOLDER = "/Users/matkatmusicllc";
const HOME_VARIABLE = "HOME";
const CURRENT_FOLDER_VARIABLE = "PWD";

// Cuts each quoted heredoc body out of the command and leaves HEREDOC_WORD where its << stood.
// Undefined for a heredoc form these rules do not read: an unquoted one (its body expands $( )), two on one line, a here-string, or no end line.
function splitHeredocBodies(command: string): HeredocSplit | undefined {
  const lines = command.split("\n");
  const keptLines: string[] = [];
  const heredocBodies: string[] = [];
  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!;
    lineIndex += 1;
    const heredoc = HEREDOC_START.exec(line);
    if (heredoc === null) {
      keptLines.push(line);
      continue;
    }
    if (line.includes(HERE_STRING_TEXT)) {
      return undefined;
    }
    if (heredoc[2] === "") {
      return undefined;
    }
    const lineEnd = line.slice(heredoc.index + heredoc[0].length);
    if (HEREDOC_START.test(lineEnd)) {
      return undefined;
    }
    keptLines.push(`${line.slice(0, heredoc.index)} ${HEREDOC_WORD} ${lineEnd}`);
    const bodyLines: string[] = [];
    let isEndFound = false;
    while (lineIndex < lines.length) {
      const bodyLine = lines[lineIndex]!;
      lineIndex += 1;
      let endCandidate = bodyLine;
      if (heredoc[1] === "-") {
        endCandidate = bodyLine.replace(/^\t+/, "");
      }
      if (endCandidate === heredoc[3]) {
        isEndFound = true;
        break;
      }
      bodyLines.push(bodyLine);
    }
    if (!isEndFound) {
      return undefined;
    }
    heredocBodies.push(bodyLines.map((bodyLine) => `${bodyLine}\n`).join(""));
  }
  return { commandText: keptLines.join("\n"), heredocBodies };
}

function isBrowserScriptText(scriptText: string): boolean {
  if (BROWSER_TEXT.test(scriptText)) {
    return true;
  }
  return isMacOnlyScriptText(scriptText);
}

// A later call that still runs can use a script that a skipped call wrote with a heredoc (shot.ts is written once and run many times).
export function writeHeredocFiles(heredocFiles: Map<string, string>): void {
  for (const [filePath, fileText] of heredocFiles) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, fileText);
  }
}

export function readScriptTextFromDisk(scriptPath: string): string | undefined {
  if (!existsSync(scriptPath)) {
    return undefined;
  }
  if (!statSync(scriptPath).isFile()) {
    return undefined;
  }
  return readFileSync(scriptPath, "utf8");
}

// Undefined when the word still holds a variable, a ~, a $( ) or a glob after the expansion, or is relative to an unknown folder.
function resolveWordPath(word: string, variables: Map<string, string>, cwd: string | undefined): string | undefined {
  let expandedWord = expandShellVariables(word, variables);
  if (expandedWord === "~") {
    expandedWord = MAC_HOME_FOLDER;
  }
  if (expandedWord.startsWith("~/")) {
    expandedWord = MAC_HOME_FOLDER + expandedWord.slice(1);
  }
  if (UNRESOLVED_PATH_TEXT.test(expandedWord)) {
    return undefined;
  }
  if (isAbsolute(expandedWord)) {
    return normalize(expandedWord);
  }
  if (cwd === undefined) {
    return undefined;
  }
  return join(cwd, expandedWord);
}

function isOutsideProjectFolder(path: string | undefined): boolean {
  if (path === undefined) {
    return false;
  }
  if (path === DISCARD_FILE) {
    return true;
  }
  const folderPath = `${path}/`;
  for (const folderStart of OUTSIDE_PROJECT_FOLDER_STARTS) {
    if (folderPath.startsWith(folderStart)) {
      return true;
    }
  }
  return false;
}

// A word with a / or a dot names a file; a word with an @ is a user name or an email.
function isFileWord(word: string): boolean {
  if (word.includes("/")) {
    return true;
  }
  if (word.includes("@")) {
    return false;
  }
  return word.includes(".");
}

// A browser or a browser script writes only into the files and folders that its words name.
function isBrowserArgumentOutsideProject(word: string, variables: Map<string, string>, cwd: string | undefined): boolean {
  let value = word;
  if (word.startsWith("-")) {
    const equalsIndex = word.indexOf("=");
    if (equalsIndex === -1) {
      return !CURRENT_FOLDER_FILE_FLAGS.has(word);
    }
    value = word.slice(equalsIndex + 1);
  }
  const expandedValue = expandShellVariables(value, variables);
  if (URL_START.test(expandedValue)) {
    return true;
  }
  if (UNRESOLVED_PATH_TEXT.test(expandedValue)) {
    return false;
  }
  if (!isFileWord(expandedValue)) {
    return true;
  }
  return isOutsideProjectFolder(resolveWordPath(expandedValue, variables, cwd));
}

function isEveryBrowserArgumentOutsideProject(argumentWords: string[], variables: Map<string, string>, cwd: string | undefined): boolean {
  for (const argumentWord of argumentWords) {
    if (!isBrowserArgumentOutsideProject(argumentWord, variables, cwd)) {
      return false;
    }
  }
  return true;
}

function isEveryFileArgumentOutsideProject(argumentWords: string[], variables: Map<string, string>, cwd: string | undefined): boolean {
  for (const argumentWord of argumentWords) {
    if (argumentWord.startsWith("-")) {
      continue;
    }
    if (!isOutsideProjectFolder(resolveWordPath(argumentWord, variables, cwd))) {
      return false;
    }
  }
  return true;
}

function setCurrentFolder(variables: Map<string, string>, cwd: string | undefined): void {
  if (cwd === undefined) {
    variables.delete(CURRENT_FOLDER_VARIABLE);
    return;
  }
  variables.set(CURRENT_FOLDER_VARIABLE, cwd);
}

// A cd to -, to no folder, to more than one word or to an unresolved folder leaves the current folder unknown.
function getFolderAfterChange(argumentWords: string[], variables: Map<string, string>, cwd: string | undefined): string | undefined {
  if (argumentWords.length !== 1) {
    return undefined;
  }
  const folderWord = argumentWords[0]!;
  if (folderWord === "-") {
    return undefined;
  }
  return resolveWordPath(folderWord, variables, cwd);
}

// heredocFiles gets each file that a cat heredoc of the call writes, with its text, so a skip can still write it.
// The default is "runs": any part these rules cannot prove writes outside the project folder makes the call run.
export function isBrowserTestWithNoProjectWrite(command: string, callCwd: Path, readScriptText: ReadScriptText, heredocFiles: Map<string, string>): boolean {
  const split = splitHeredocBodies(command);
  if (split === undefined) {
    return false;
  }
  const parsed = parseShellCommand(split.commandText);
  if (parsed.hasUncheckedText) {
    return false;
  }
  const hasSubshell = SUBSHELL_START.test(split.commandText);
  const variables = new Map<string, string>([[HOME_VARIABLE, MAC_HOME_FOLDER]]);
  let cwd: string | undefined = callCwd.toString();
  setCurrentFolder(variables, cwd);
  let drivesBrowser = BROWSER_TEXT.test(command);
  let heredocIndex = 0;
  for (const segment of parsed.segments) {
    recordShellVariables(segment, variables);
    for (const target of segment.redirectTargets) {
      if (!isOutsideProjectFolder(resolveWordPath(target, variables, cwd))) {
        return false;
      }
    }
    const programWords = getProgramWords(segment);
    const programName = getProgramName(programWords);
    const argumentWords = programWords.slice(1);
    if (segment.words.includes(HEREDOC_WORD)) {
      if (programName !== HEREDOC_PROGRAM) {
        return false;
      }
      if (programWords.length !== 2) {
        return false;
      }
      const heredocBody = split.heredocBodies[heredocIndex]!;
      heredocIndex += 1;
      for (const target of segment.redirectTargets) {
        heredocFiles.set(resolveWordPath(target, variables, cwd)!, heredocBody);
      }
      continue;
    }
    if (programName === undefined) {
      if (!isEveryRedirectDiscarded(segment)) {
        return false;
      }
      continue;
    }
    if (BROWSER_PROGRAM_TEXT.test(expandShellVariables(programWords[0]!, variables))) {
      if (!isEveryBrowserArgumentOutsideProject(argumentWords, variables, cwd)) {
        return false;
      }
      drivesBrowser = true;
      continue;
    }
    if (BROWSER_SCRIPT_RUNNER_PROGRAMS.has(programName)) {
      const scriptWord = argumentWords[0];
      if (scriptWord === undefined) {
        return false;
      }
      if (scriptWord.startsWith("-")) {
        return false;
      }
      const scriptPath = resolveWordPath(scriptWord, variables, cwd);
      if (scriptPath === undefined) {
        return false;
      }
      const scriptText = heredocFiles.get(scriptPath) ?? readScriptText(scriptPath);
      if (scriptText === undefined) {
        return false;
      }
      if (!isBrowserScriptText(scriptText)) {
        return false;
      }
      if (!isEveryBrowserArgumentOutsideProject(argumentWords.slice(1), variables, cwd)) {
        return false;
      }
      drivesBrowser = true;
      continue;
    }
    // A later call that still runs may read what another command wrote, so only browser output and heredoc files may go unwritten.
    if (!isEveryRedirectDiscarded(segment)) {
      return false;
    }
    if (programName === CHANGE_FOLDER_PROGRAM) {
      cwd = getFolderAfterChange(argumentWords, variables, cwd);
      if (hasSubshell) {
        cwd = undefined;
      }
      setCurrentFolder(variables, cwd);
      continue;
    }
    if (FILE_ARGUMENT_PROGRAMS.has(programName)) {
      if (!isEveryFileArgumentOutsideProject(argumentWords, variables, cwd)) {
        return false;
      }
      continue;
    }
    if (!isSegmentReadOnly(segment)) {
      return false;
    }
  }
  return drivesBrowser;
}

// Text in a command that starts Chrome or Chromium, or talks to one it started.
const CHROME_COMMAND_TEXTS = [CHROME_NAME_TEXT, "remote-debugging-port", "--headless", "chromium"];

// Called after the command ran, so a script file that the command itself wrote is there to read.
export function isChromeStartCommand(command: string, cwd: Path): boolean {
  for (const chromeText of CHROME_COMMAND_TEXTS) {
    if (command.includes(chromeText)) {
      return true;
    }
  }
  const variables = new Map<string, string>();
  for (const segment of parseShellCommand(command).segments) {
    recordShellVariables(segment, variables);
    if (isChromeScriptFileRun(segment, variables, cwd)) {
      return true;
    }
  }
  return false;
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
