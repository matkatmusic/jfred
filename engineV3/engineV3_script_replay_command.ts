import { basename, isAbsolute, join } from "node:path";

import { ENVIRONMENT_ASSIGNMENT, parseShellCommand, SUBSTITUTION_PLACEHOLDER, type ShellSegment } from "./engineV3_replay_script_internet.ts";

export enum ParsedCommandKind {
    parsed = "parsed",
    unsupported = "unsupported",
}

export type ParsedInvokedCommand =
    | { kind: ParsedCommandKind.parsed; workingFolder: string | null; settings: Record<string, string>; words: string[] }
    | { kind: ParsedCommandKind.unsupported; reason: string };

const RUNNER_NAMES = new Set(["python3", "python", "bash", "sh"]);
const REFUSED_SETTING_NAMES = new Set(["PATH", "HOME", "TMPDIR", "LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONHOME", "BASH_ENV", "ENV", "PYTHONSTARTUP", "LD_AUDIT", "GCONV_PATH"]);
// Old local copy; SUBSTITUTION_PLACEHOLDER is now imported.
// const SUBSTITUTION_PLACEHOLDER = "$()";

// ponytail: a word with a glob character or ~ is passed as typed (parseShellCommand removes the quotes, so the cases cannot be told apart); options between runner and script never reach here.
export function parseInvokedCommand(commandText: string, invokedScriptPath: string): ParsedInvokedCommand {
    const parsed = parseShellCommand(commandText);
    const foundIndex = findScriptSegmentIndex(parsed.segments, invokedScriptPath);
    if (foundIndex === -1) {
        return { kind: ParsedCommandKind.parsed, workingFolder: null, settings: {}, words: [] };
    }
    if (parsed.hasUncheckedText) {
        if (foundIndex === parsed.segments.length - 1) {
            return { kind: ParsedCommandKind.unsupported, reason: "the script's command line holds text the replay cannot read (a backtick, a heredoc or an unclosed quote)" };
        }
    }
    const segment = parsed.segments[foundIndex]!;
    const scriptWordIndex = findScriptWordIndex(segment, invokedScriptPath);
    const words = segment.words.slice(scriptWordIndex + 1);
    const hasDollarWord = words.some((word) => word.includes("$"));
    if (hasDollarWord) {
        return { kind: ParsedCommandKind.unsupported, reason: "the command line uses $, which the replay cannot expand" };
    }
    const settingsResult = readSettings(segment.words.slice(0, scriptWordIndex - 1));
    if (settingsResult.kind === ParsedCommandKind.unsupported) {
        return settingsResult;
    }
    const workingFolder = readWorkingFolder(parsed.segments.slice(0, foundIndex));
    return { kind: ParsedCommandKind.parsed, workingFolder, settings: settingsResult.settings, words };
}

function findScriptWordIndex(segment: ShellSegment, invokedScriptPath: string): number {
    for (let index = 1; index < segment.words.length; index++) {
        if (segment.words[index] === invokedScriptPath) {
            if (RUNNER_NAMES.has(basename(segment.words[index - 1]!))) {
                const assignmentWords = segment.words.slice(0, index - 1);
                if (assignmentWords.every((word) => ENVIRONMENT_ASSIGNMENT.test(word))) {
                    return index;
                }
            }
        }
    }
    return -1;
}

function findScriptSegmentIndex(segments: ShellSegment[], invokedScriptPath: string): number {
    return segments.findIndex((segment) => findScriptWordIndex(segment, invokedScriptPath) !== -1);
}

function readSettings(assignmentWords: string[]): { kind: ParsedCommandKind.parsed; settings: Record<string, string> } | { kind: ParsedCommandKind.unsupported; reason: string } {
    const settings: Record<string, string> = {};
    for (const assignmentWord of assignmentWords) {
        const equalsIndex = assignmentWord.indexOf("=");
        const name = assignmentWord.slice(0, equalsIndex);
        const value = assignmentWord.slice(equalsIndex + 1);
        if (REFUSED_SETTING_NAMES.has(name)) {
            return { kind: ParsedCommandKind.unsupported, reason: `the setting ${name} would change how the container starts programs` };
        }
        if (value.includes("$")) {
            return { kind: ParsedCommandKind.unsupported, reason: `the setting ${name} uses $ or ~, which the replay cannot expand` };
        }
        if (value.startsWith("~")) {
            return { kind: ParsedCommandKind.unsupported, reason: `the setting ${name} uses $ or ~, which the replay cannot expand` };
        }
        if (value.includes(":~")) {
            return { kind: ParsedCommandKind.unsupported, reason: `the setting ${name} uses $ or ~, which the replay cannot expand` };
        }
        settings[name] = value;
    }
    return { kind: ParsedCommandKind.parsed, settings };
}

function readWorkingFolder(earlierSegments: ShellSegment[]): string | null {
    // The inner commands of a $( ) come out as segments before the outer one, so they are skipped.
    let lastSubstitutionIndex = -1;
    for (const [index, segment] of earlierSegments.entries()) {
        if (segment.words.some((word) => word.includes(SUBSTITUTION_PLACEHOLDER))) {
            lastSubstitutionIndex = index;
        }
    }
    let workingFolder: string | null = null;
    for (const segment of earlierSegments.slice(lastSubstitutionIndex + 1)) {
        if (segment.words.length === 2) {
            if (segment.words[0] === "cd") {
                const folder = segment.words[1]!;
                if (isPlainFolder(folder)) {
                    if (isAbsolute(folder)) {
                        workingFolder = folder;
                    } else {
                        if (workingFolder === null) {
                            workingFolder = folder;
                        } else {
                            workingFolder = join(workingFolder, folder);
                        }
                    }
                }
            }
        }
    }
    return workingFolder;
}

function isPlainFolder(folder: string): boolean {
    if (folder === "-") {
        return false;
    }
    if (folder.includes("~")) {
        return false;
    }
    return !folder.includes("$");
}
