// Syntax highlighting for Details-view file content. hljs is a vendored global, absent under node:test.
declare global {
  const hljs: {
    highlight(code: string, options: { language: string; ignoreIllegals: boolean }): { value: string };
    getLanguage(name: string): unknown;
  };
}

// File extension -> highlight.js language name; undefined = render as plain text.
const LANGUAGE_BY_EXTENSION: ReadonlyMap<string, string> = new Map([
  ["py", "python"], ["ts", "typescript"], ["tsx", "typescript"],
  ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"], ["jsx", "javascript"],
  ["json", "json"], ["md", "markdown"], ["css", "css"], ["html", "xml"],
  ["sh", "bash"], ["bash", "bash"], ["zsh", "bash"], ["yml", "yaml"], ["yaml", "yaml"],
]);

// The highlight.js language from a path extension; undefined for unknown or missing extensions.
export function computeLanguageForPath(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return undefined;
  }
  return LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase());
}

// Fill an element with file text, highlighted when the language and hljs are known; else plain text.
export function renderCodeInto(element: HTMLElement, content: string, path: string): void {
  const language = computeLanguageForPath(path);
  const isLanguageKnown = language !== undefined;
  const isHljsLoaded = typeof hljs !== "undefined";
  const canHighlight = isLanguageKnown && isHljsLoaded && hljs.getLanguage(language) !== undefined;
  if (canHighlight) {
    // hljs HTML-escapes the source text itself, so this is not an injection surface.
    element.innerHTML = hljs.highlight(content, { language, ignoreIllegals: true }).value;
    element.classList.add("hljs");
    return;
  }
  element.textContent = content;
}

