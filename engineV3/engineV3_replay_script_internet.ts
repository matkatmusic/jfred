// Rules for the recorded Bash calls that need the internet and change no file in the container: the replay skips them (user decision 8).

// One simple command between ; && || | & ( ) or a new line, with its quotes taken off.
type ShellSegment = { words: string[]; redirectTargets: string[] };

// hasUncheckedText: a $( ), a backtick, a heredoc or a quote that is never closed (zsh rejects it) holds text that these rules cannot check.
type ParsedShellCommand = { segments: ShellSegment[]; hasUncheckedText: boolean };

const SEGMENT_END_CHARACTERS = new Set([";", "|", "&", "(", ")", "\n"]);
const WHITESPACE_CHARACTERS = new Set([" ", "\t"]);
const QUOTE_CHARACTERS = new Set(["'", "\""]);
const DIGITS_ONLY = /^\d+$/;
const STREAM_NUMBER_CHARACTERS = /^[\d-]$/;
const ENVIRONMENT_ASSIGNMENT = /^[A-Za-z_]\w*=/;
const URL_HOST = /[A-Za-z][A-Za-z0-9+.-]*:\/\/(\[[^\]]*\]|[^/:?#\s]*)/g;
const DISCARD_FILE = "/dev/null";

// Words that start a loop or a test and run no program by themselves.
const LEADING_SHELL_KEYWORDS = new Set(["do", "then", "else", "if", "while", "until", "!"]);

// Programs that reach another machine. bunx and npx are left out: the Attune Bash calls use them only to run tsc and eslint.
const INTERNET_PROGRAMS = new Set(["curl", "wget", "dig", "nslookup", "host", "ping", "ssh", "scp", "sftp", "rsync", "nc", "telnet", "gh", "brew"]);
const INTERNET_SUBCOMMANDS = new Map([
  ["git", new Set(["fetch", "pull", "push", "clone", "ls-remote"])],
  ["npm", new Set(["install", "i", "ci", "add", "publish", "view"])],
  ["bun", new Set(["add", "install", "i"])],
  ["pip", new Set(["install"])],
  ["pip3", new Set(["install"])],
  ["docker", new Set(["pull"])],
]);
// These programs need the internet only when a URL in the command names another machine.
const PROGRAMS_THAT_NAME_A_URL = new Set(["curl", "wget"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]);

// Programs that change no file in the container. ssh is here because it changes files only on the other machine.
const READ_ONLY_PROGRAMS = new Set(["rg", "grep", "cat", "head", "tail", "ls", "echo", "printf", "jq", "wc", "cut", "cd", "true", "sleep", "for", "done", "fi", "ps", "pgrep", "dig", "nslookup", "host", "ping", "ssh"]);
// curl flags that save into a file named by the next word.
const CURL_FILE_FLAGS = new Set(["-o", "--output", "-D", "--dump-header", "-c", "--cookie-jar"]);
const CURL_FILE_FLAG_LETTERS = new Set(["o", "D", "c"]);
const CURL_ALWAYS_WRITING_FLAGS = new Set(["-O", "--remote-name", "--remote-name-all", "--output-dir", "--create-dirs", "--trace", "--trace-ascii", "--stderr", "--libcurl", "--etag-save"]);
const CURL_SHORT_FLAG_GROUP = /^-[A-Za-z]+$/;
const CURL_REMOTE_NAME_LETTER = "O";

function isHiddenCommandStart(command: string, index: number): boolean {
  const character = command[index];
  if (character === "`") {
    return true;
  }
  if (character === "$") {
    return command[index + 1] === "(";
  }
  return false;
}

// hasUncheckedText: the text holds a $( ) or a backtick, or the quote is never closed, so reading stops there.
function readQuotedText(command: string, start: number, quote: string): { text: string; end: number; hasUncheckedText: boolean } {
  let text = "";
  let index = start + 1;
  while (index < command.length) {
    const character = command[index]!;
    if (character === quote) {
      return { text, end: index + 1, hasUncheckedText: false };
    }
    if (quote === "\"") {
      if (character === "\\") {
        text += command[index + 1] ?? "";
        index += 2;
        continue;
      }
      if (isHiddenCommandStart(command, index)) {
        return { text, end: index, hasUncheckedText: true };
      }
    }
    text += character;
    index += 1;
  }
  return { text, end: index, hasUncheckedText: true };
}

// Splits a shell command into simple commands and their redirect targets, with quotes respected. The parse stops at the first $( ), backtick or heredoc.
export function parseShellCommand(command: string): ParsedShellCommand {
  const segments: ShellSegment[] = [];
  let words: string[] = [];
  let redirectTargets: string[] = [];
  let word = "";
  let hasWord = false;
  let isReadingRedirectTarget = false;
  const finishWord = (): void => {
    if (!hasWord) {
      return;
    }
    if (isReadingRedirectTarget) {
      redirectTargets.push(word);
      isReadingRedirectTarget = false;
    } else {
      words.push(word);
    }
    word = "";
    hasWord = false;
  };
  const finishSegment = (): void => {
    finishWord();
    if (words.length > 0) {
      segments.push({ words, redirectTargets });
    }
    if (words.length === 0) {
      if (redirectTargets.length > 0) {
        segments.push({ words, redirectTargets });
      }
    }
    words = [];
    redirectTargets = [];
  };
  let index = 0;
  while (index < command.length) {
    const character = command[index]!;
    if (QUOTE_CHARACTERS.has(character)) {
      const quoted = readQuotedText(command, index, character);
      word += quoted.text;
      hasWord = true;
      if (quoted.hasUncheckedText) {
        finishSegment();
        return { segments, hasUncheckedText: true };
      }
      index = quoted.end;
      continue;
    }
    if (character === "\\") {
      // A backslash before a new line joins the two lines and adds no text.
      if (command[index + 1] === "\n") {
        index += 2;
        continue;
      }
      word += command[index + 1] ?? "";
      hasWord = true;
      index += 2;
      continue;
    }
    if (isHiddenCommandStart(command, index)) {
      finishSegment();
      return { segments, hasUncheckedText: true };
    }
    if (character === "#") {
      if (!hasWord) {
        while (index < command.length) {
          if (command[index] === "\n") {
            break;
          }
          index += 1;
        }
        continue;
      }
    }
    if (character === "<") {
      // The heredoc body is code or text, not shell words, so the parse stops here.
      if (command[index + 1] === "<") {
        finishSegment();
        return { segments, hasUncheckedText: true };
      }
      if (command[index + 1] === "(") {
        finishSegment();
        return { segments, hasUncheckedText: true };
      }
    }
    if (character === ">") {
      // A word of digits right before > is the stream number, not a word of the command.
      if (DIGITS_ONLY.test(word)) {
        word = "";
        hasWord = false;
      }
      finishWord();
      index += 1;
      if (command[index] === ">") {
        index += 1;
      }
      if (command[index] === "|") {
        index += 1;
      }
      if (command[index] === "(") {
        finishSegment();
        return { segments, hasUncheckedText: true };
      }
      // >&2 and 2>&1 copy a stream and write no file.
      if (command[index] === "&") {
        index += 1;
        while (STREAM_NUMBER_CHARACTERS.test(command[index] ?? "")) {
          index += 1;
        }
        continue;
      }
      isReadingRedirectTarget = true;
      continue;
    }
    if (character === "&") {
      if (command[index + 1] === ">") {
        finishWord();
        index += 1;
        continue;
      }
    }
    if (WHITESPACE_CHARACTERS.has(character)) {
      finishWord();
      index += 1;
      continue;
    }
    if (SEGMENT_END_CHARACTERS.has(character)) {
      finishSegment();
      index += 1;
      continue;
    }
    word += character;
    hasWord = true;
    index += 1;
  }
  finishSegment();
  return { segments, hasUncheckedText: false };
}

// The program word and the words after it, past leading VAR=value words and loop or test keywords.
function getProgramWords(segment: ShellSegment): string[] {
  let start = 0;
  while (start < segment.words.length) {
    const word = segment.words[start]!;
    const isAssignment = ENVIRONMENT_ASSIGNMENT.test(word);
    const isKeyword = LEADING_SHELL_KEYWORDS.has(word);
    if (!isAssignment) {
      if (!isKeyword) {
        break;
      }
    }
    start += 1;
  }
  return segment.words.slice(start);
}

function getProgramName(programWords: string[]): string | undefined {
  const programWord = programWords[0];
  if (programWord === undefined) {
    return undefined;
  }
  const lastSlash = programWord.lastIndexOf("/");
  return programWord.slice(lastSlash + 1);
}

function hasUrlToAnotherMachine(programWords: string[]): boolean {
  for (const word of programWords) {
    for (const match of word.matchAll(URL_HOST)) {
      const host = match[1]!;
      if (!LOCAL_HOSTS.has(host)) {
        return true;
      }
    }
  }
  return false;
}

function isSegmentInternet(segment: ShellSegment): boolean {
  const programWords = getProgramWords(segment);
  const programName = getProgramName(programWords);
  if (programName === undefined) {
    return false;
  }
  if (PROGRAMS_THAT_NAME_A_URL.has(programName)) {
    return hasUrlToAnotherMachine(programWords);
  }
  if (INTERNET_PROGRAMS.has(programName)) {
    return true;
  }
  const internetSubcommands = INTERNET_SUBCOMMANDS.get(programName);
  if (internetSubcommands === undefined) {
    return false;
  }
  return internetSubcommands.has(programWords[1] ?? "");
}

// A file flag is read-only only when its file is /dev/null.
function isCurlFileFlagReadOnly(flagWord: string, nextWord: string | undefined): boolean {
  if (CURL_FILE_FLAGS.has(flagWord)) {
    return nextWord === DISCARD_FILE;
  }
  if (CURL_SHORT_FLAG_GROUP.test(flagWord)) {
    if (flagWord.includes(CURL_REMOTE_NAME_LETTER)) {
      return false;
    }
    for (let letterIndex = 1; letterIndex < flagWord.length; letterIndex += 1) {
      const letter = flagWord[letterIndex]!;
      if (CURL_FILE_FLAG_LETTERS.has(letter)) {
        const isLastLetter = letterIndex === flagWord.length - 1;
        if (!isLastLetter) {
          return false;
        }
        return nextWord === DISCARD_FILE;
      }
    }
    return true;
  }
  const flagName = flagWord.split("=")[0]!;
  if (CURL_FILE_FLAGS.has(flagName)) {
    return flagWord.slice(flagName.length + 1) === DISCARD_FILE;
  }
  return !CURL_ALWAYS_WRITING_FLAGS.has(flagName);
}

function isCurlReadOnly(programWords: string[]): boolean {
  for (let wordIndex = 1; wordIndex < programWords.length; wordIndex += 1) {
    const word = programWords[wordIndex]!;
    if (!word.startsWith("-")) {
      continue;
    }
    const isFlagReadOnly = isCurlFileFlagReadOnly(word, programWords[wordIndex + 1]);
    if (!isFlagReadOnly) {
      return false;
    }
  }
  return true;
}

function isSegmentReadOnly(segment: ShellSegment): boolean {
  for (const target of segment.redirectTargets) {
    if (target !== DISCARD_FILE) {
      return false;
    }
  }
  const programWords = getProgramWords(segment);
  const programName = getProgramName(programWords);
  if (programName === undefined) {
    return true;
  }
  if (programName === "curl") {
    return isCurlReadOnly(programWords);
  }
  return READ_ONLY_PROGRAMS.has(programName);
}

export function isInternetCommand(command: string): boolean {
  const parsed = parseShellCommand(command);
  for (const segment of parsed.segments) {
    if (isSegmentInternet(segment)) {
      return true;
    }
  }
  return false;
}

// A command these rules cannot check counts as changing files.
export function isReadOnlyCommand(command: string): boolean {
  const parsed = parseShellCommand(command);
  if (parsed.hasUncheckedText) {
    return false;
  }
  for (const segment of parsed.segments) {
    if (!isSegmentReadOnly(segment)) {
      return false;
    }
  }
  return true;
}

export function isReadOnlyInternetCommand(command: string): boolean {
  if (!isInternetCommand(command)) {
    return false;
  }
  return isReadOnlyCommand(command);
}
