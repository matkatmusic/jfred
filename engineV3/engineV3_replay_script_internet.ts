// Rules for the recorded Bash calls that need the internet and change no file in the container: the replay skips them (user decision 8).

// One simple command between ; && || | & ( ) or a new line, with its quotes taken off.
type ShellSegment = { words: string[]; redirectTargets: string[] };

// hasUncheckedText: a backtick, a heredoc, a $( ) too deep to read, or a quote or $( ) that is never closed (zsh rejects it) holds text that these rules cannot check.
type ParsedShellCommand = { segments: ShellSegment[]; hasUncheckedText: boolean };
// end: the index just past the ) that closes a $( ).
type ParsedShellText = ParsedShellCommand & { end: number };

// The commands inside a $( ) are read down to this depth of $( ) inside $( ).
const MAXIMUM_SUBSTITUTION_DEPTH = 3;
// Stands in a word for the output of a $( ), which is not known.
const SUBSTITUTION_PLACEHOLDER = "$()";

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
const READ_ONLY_PROGRAMS = new Set(["rg", "grep", "cat", "head", "tail", "ls", "echo", "printf", "jq", "wc", "cut", "cd", "true", "sleep", "for", "done", "fi", "ps", "pgrep", "dig", "nslookup", "host", "ping", "ssh", "pkill", "kill", "lsof", "sysctl", "tr", "[", "break"]);
// sort -o and --output write the sorted text into a file.
const SORT_OUTPUT_FLAG_LETTER = "o";
const SORT_OUTPUT_LONG_FLAG = "--output";
// sed -i and --in-place change the file they read. sed -f and --file read the sed text from a file that these rules cannot check.
const SED_UNCHECKED_FLAG_LETTERS = ["i", "f"];
const SED_UNCHECKED_LONG_FLAG_STARTS = ["--in-place", "--file"];
// The sed w and W commands and the s///w flag write a file. GNU sed runs a command with e.
const SED_WRITING_TEXT = /[wW]\s|(^|[;{}\s])e(\s|$)|\/[gpiImM0-9]*e/;
// In awk text a > or | after print sends the output to a file or a command, and system( runs a command.
const AWK_WRITING_TEXT = /print[^;}]*[>|]|system\(|\|/;
// Programs that only look at Mac programs or Mac machine state, or stop a program (user decision 9).
const MAC_STATE_PROGRAMS = new Set(["ps", "pgrep", "pkill", "kill", "lsof", "tmux", "sysctl"]);
// Folders that hold the state of live Mac programs: a file there exists only while its program runs. A word that starts with one names Mac state.
const LIVE_MAC_STATE_PATH_STARTS = ["~/.claude/sessions", "$HOME/.claude/sessions", "${HOME}/.claude/sessions", "/Users/matkatmusicllc/.claude/sessions"];
// tmux subcommands that start no program. Every list-, show- and kill- subcommand is also one.
const TMUX_READ_ONLY_SUBCOMMANDS = new Set(["ls", "has-session", "has", "display-message", "display", "capture-pane", "capturep"]);
const TMUX_READ_ONLY_SUBCOMMAND_STARTS = ["list-", "show-", "kill-"];
// tmux runs the words after a ; as one more subcommand.
const TMUX_SUBCOMMAND_SEPARATOR = ";";
// curl flags that save into a file named by the next word.
const CURL_FILE_FLAGS = new Set(["-o", "--output", "-D", "--dump-header", "-c", "--cookie-jar"]);
const CURL_FILE_FLAG_LETTERS = new Set(["o", "D", "c"]);
const CURL_ALWAYS_WRITING_FLAGS = new Set(["-O", "--remote-name", "--remote-name-all", "--output-dir", "--create-dirs", "--trace", "--trace-ascii", "--stderr", "--libcurl", "--etag-save"]);
const LONG_FLAG_START = "--";
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

// $(( )) is arithmetic, not a command.
function isCommandSubstitutionStart(command: string, index: number): boolean {
  if (command[index] !== "$") {
    return false;
  }
  if (command[index + 1] !== "(") {
    return false;
  }
  return command[index + 2] !== "(";
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

// Splits a shell command into simple commands and their redirect targets, with quotes respected.
// The simple commands inside a $( ) are added to the list. The parse stops at the first backtick or heredoc.
export function parseShellCommand(command: string): ParsedShellCommand {
  const parsed = parseShellText(command, 0, 0);
  return { segments: parsed.segments, hasUncheckedText: parsed.hasUncheckedText };
}

// Inside a $( ) (substitutionDepth above 0) the parse ends at the ) that closes it.
function parseShellText(command: string, start: number, substitutionDepth: number): ParsedShellText {
  const segments: ShellSegment[] = [];
  let openParenthesisCount = 0;
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
  let index = start;
  while (index < command.length) {
    const character = command[index]!;
    if (QUOTE_CHARACTERS.has(character)) {
      const quoted = readQuotedText(command, index, character);
      word += quoted.text;
      hasWord = true;
      if (quoted.hasUncheckedText) {
        finishSegment();
        return { segments, hasUncheckedText: true, end: quoted.end };
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
    if (isCommandSubstitutionStart(command, index)) {
      if (substitutionDepth < MAXIMUM_SUBSTITUTION_DEPTH) {
        const substitution = parseShellText(command, index + 2, substitutionDepth + 1);
        segments.push(...substitution.segments);
        if (substitution.hasUncheckedText) {
          finishSegment();
          return { segments, hasUncheckedText: true, end: substitution.end };
        }
        word += SUBSTITUTION_PLACEHOLDER;
        hasWord = true;
        index = substitution.end;
        continue;
      }
    }
    if (isHiddenCommandStart(command, index)) {
      finishSegment();
      return { segments, hasUncheckedText: true, end: index };
    }
    if (character === ")") {
      if (substitutionDepth > 0) {
        if (openParenthesisCount === 0) {
          finishSegment();
          return { segments, hasUncheckedText: false, end: index + 1 };
        }
      }
      openParenthesisCount -= 1;
    }
    if (character === "(") {
      openParenthesisCount += 1;
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
        return { segments, hasUncheckedText: true, end: index };
      }
      if (command[index + 1] === "(") {
        finishSegment();
        return { segments, hasUncheckedText: true, end: index };
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
        return { segments, hasUncheckedText: true, end: index };
      }
      // >&2 and 2>&1 copy a stream and write no file.
      // In zsh >& file writes both streams into the file.
      if (command[index] === "&") {
        index += 1;
        if (STREAM_NUMBER_CHARACTERS.test(command[index] ?? "")) {
          while (STREAM_NUMBER_CHARACTERS.test(command[index] ?? "")) {
            index += 1;
          }
          continue;
        }
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
  // Inside a $( ) the text ends before the ) that closes it.
  const isSubstitutionNeverClosed = substitutionDepth > 0;
  return { segments, hasUncheckedText: isSubstitutionNeverClosed, end: index };
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
  // A short flag group such as -sSLo: the file of o, D or c is the rest of the word, or the next word.
  if (!flagWord.startsWith(LONG_FLAG_START)) {
    for (let letterIndex = 1; letterIndex < flagWord.length; letterIndex += 1) {
      const letter = flagWord[letterIndex]!;
      if (letter === CURL_REMOTE_NAME_LETTER) {
        return false;
      }
      if (CURL_FILE_FLAG_LETTERS.has(letter)) {
        const joinedFile = flagWord.slice(letterIndex + 1);
        if (joinedFile === "") {
          return nextWord === DISCARD_FILE;
        }
        return joinedFile === DISCARD_FILE;
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

function isTmuxReadOnly(programWords: string[]): boolean {
  if (programWords.includes(TMUX_SUBCOMMAND_SEPARATOR)) {
    return false;
  }
  const subcommand = programWords[1] ?? "";
  if (TMUX_READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return true;
  }
  for (const subcommandStart of TMUX_READ_ONLY_SUBCOMMAND_STARTS) {
    if (subcommand.startsWith(subcommandStart)) {
      return true;
    }
  }
  return false;
}

function isSortReadOnly(programWords: string[]): boolean {
  for (const word of programWords.slice(1)) {
    if (word.startsWith(SORT_OUTPUT_LONG_FLAG)) {
      return false;
    }
    if (word.startsWith("-")) {
      if (!word.startsWith(LONG_FLAG_START)) {
        if (word.includes(SORT_OUTPUT_FLAG_LETTER)) {
          return false;
        }
      }
    }
  }
  return true;
}

// uniq writes into its second file word. A lone - stands for the input.
function isUniqReadOnly(programWords: string[]): boolean {
  const fileWords = programWords.slice(1).filter((word) => word === "-" || !word.startsWith("-"));
  return fileWords.length <= 1;
}

function isSedReadOnly(programWords: string[]): boolean {
  for (const word of programWords.slice(1)) {
    for (const flagStart of SED_UNCHECKED_LONG_FLAG_STARTS) {
      if (word.startsWith(flagStart)) {
        return false;
      }
    }
    // A short flag group such as -Ei holds i in any place.
    if (word.startsWith("-")) {
      if (!word.startsWith(LONG_FLAG_START)) {
        for (const flagLetter of SED_UNCHECKED_FLAG_LETTERS) {
          if (word.includes(flagLetter)) {
            return false;
          }
        }
      }
    }
    if (SED_WRITING_TEXT.test(word)) {
      return false;
    }
  }
  return true;
}

function isAwkReadOnly(programWords: string[]): boolean {
  for (const word of programWords.slice(1)) {
    if (AWK_WRITING_TEXT.test(word)) {
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
  if (programName === "tmux") {
    return isTmuxReadOnly(programWords);
  }
  if (programName === "sort") {
    return isSortReadOnly(programWords);
  }
  if (programName === "uniq") {
    return isUniqReadOnly(programWords);
  }
  if (programName === "sed") {
    return isSedReadOnly(programWords);
  }
  if (programName === "awk") {
    return isAwkReadOnly(programWords);
  }
  return READ_ONLY_PROGRAMS.has(programName);
}

function isLiveMacStatePath(word: string): boolean {
  for (const pathStart of LIVE_MAC_STATE_PATH_STARTS) {
    if (word.startsWith(pathStart)) {
      return true;
    }
  }
  return false;
}

function isSegmentMacState(segment: ShellSegment): boolean {
  const programWords = getProgramWords(segment);
  const programName = getProgramName(programWords);
  if (programName === undefined) {
    return false;
  }
  if (MAC_STATE_PROGRAMS.has(programName)) {
    return true;
  }
  return programWords.some(isLiveMacStatePath);
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

export function isMacStateCommand(command: string): boolean {
  const parsed = parseShellCommand(command);
  for (const segment of parsed.segments) {
    if (isSegmentMacState(segment)) {
      return true;
    }
  }
  return false;
}

export function isReadOnlyMacStateCommand(command: string): boolean {
  if (!isMacStateCommand(command)) {
    return false;
  }
  return isReadOnlyCommand(command);
}
