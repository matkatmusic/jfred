// Named regex source fragments that regex_expressions.ts composes into patterns.
export const startAnchor = "^";
export const digit = "\\d";
export const wordChar = "\\w";
export const whitespace = "\\s";
export const nonWhitespace = "\\S";
export const anyChar = ".";
export const literalDot = "\\.";
export const lowercaseLetter = "[a-z]";
export const literalPipe = "\\|";
export const oneOrMore = "+";
export const zeroOrMore = "*";
// Makes the preceding quantifier non-greedy.
export const lazy = "?";
export const tab = "\\t";
export const endAnchor = "$";

// A flag for `new RegExp(source, flags)`, not a source fragment.
export const globalFlag = "g";

export const oneOrMoreWhitespace = whitespace + oneOrMore;
export const zeroOrMoreWhitespace = whitespace + zeroOrMore;
export const wrapCapture = (inner: string): string => "(" + inner + ")";
export const wrapOptionalGroup = (inner: string): string => "(?:" + inner + ")?";
export const capturedWord = wrapCapture(nonWhitespace + oneOrMore);

export const wrapLookahead = (inner: string): string => "(?=" + inner + ")";
export const wrapNegativeLookahead = (inner: string): string => "(?!" + inner + ")";
export const wrapNegativeLookbehind = (inner: string): string => "(?<!" + inner + ")";
export const matchAnyOf = (...alternatives: string[]): string => "(?:" + alternatives.join("|") + ")";
export const matchNoneOf = (chars: string): string => "[^" + chars + "]";
export const matchOneOf = (chars: string): string => "[" + chars + "]";
export const matchRepeatBetween = (min: number, max: number): string => "{" + min + "," + max + "}";
