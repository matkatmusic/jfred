// JSON token pattern and classification for the inspector's highlighted-JSON rendering.

// Matches strings, keys, booleans, null and numbers; text between tokens stays plain.
export const JSON_TOKEN_PATTERN = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g;

export const JSON_STRING_CLASS = "json-string";

// A string value longer than this gets the […] toggle; 560 is about 7 lines of 80 chars.
const LONG_VALUE_CHAR_LIMIT = 560;

export function getTokenClass(token: string): string {
  const isStringToken = token.startsWith('"');
  if (isStringToken) {
    const isKey = token.trimEnd().endsWith(":");
    return isKey ? "json-key" : JSON_STRING_CLASS;
  }
  const isTrue = token === "true";
  const isFalse = token === "false";
  const isBool = isTrue || isFalse;
  if (isBool) {
    return "json-bool";
  }
  if (token === "null") {
    return "json-null";
  }
  return "json-number";
}

export function isValueLong(tokenClass: string, token: string): boolean {
  if (tokenClass !== JSON_STRING_CLASS) {
    return false;
  }
  return token.length > LONG_VALUE_CHAR_LIMIT;
}
