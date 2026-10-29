// The wire script languages: ctx_execute languages plus bash. One source for label and highlighting.

export const WireScriptLanguage = {
  javascript: "javascript",
  typescript: "typescript",
  python: "python",
  shell: "shell",
  ruby: "ruby",
  go: "go",
  rust: "rust",
  php: "php",
  perl: "perl",
  r: "r",
  elixir: "elixir",
  csharp: "csharp",
  bash: "bash",
} as const;
export type WireScriptLanguage = (typeof WireScriptLanguage)[keyof typeof WireScriptLanguage];

// Every language reads "<language> run" (the node label, the drawer title and the executor row).
export function formatScriptRunLabel(language: WireScriptLanguage): string {
  // return language === WireScriptLanguage.bash ? "$" : `${language} run`;
  return `${language} run`;
}

const HIGHLIGHT_LANGUAGE_BY_SCRIPT_LANGUAGE: ReadonlyMap<WireScriptLanguage, string> = new Map([
  [WireScriptLanguage.python, "python"],
  [WireScriptLanguage.shell, "bash"],
  [WireScriptLanguage.bash, "bash"],
  [WireScriptLanguage.javascript, "javascript"],
  [WireScriptLanguage.typescript, "typescript"],
]);

// The highlight.js language for a script language; undefined (plain text) for the rest.
export function computeScriptHighlightLanguage(language: WireScriptLanguage): string | undefined {
  return HIGHLIGHT_LANGUAGE_BY_SCRIPT_LANGUAGE.get(language);
}

// A parsed wire value: a free-form string from a tool input becomes the vocabulary or throws.
export function parseScriptLanguage(value: string): WireScriptLanguage {
  for (const candidate of Object.values(WireScriptLanguage)) {
    if (candidate === value) {
      return candidate;
    }
  }
  throw new Error(`unknown script language: ${value}`);
}
