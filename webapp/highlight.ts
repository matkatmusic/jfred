// Syntax highlighting for Details-view file content (item 49). hljs is the vendored highlight.js script-tag global (webapp/vendor/highlight.min.js) — absent under node:test, so every touch is guarded and the fallback is plain text.
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

// The highlight.js language for a file path, from its extension; undefined for unknown extensions and extensionless paths.
export function computeLanguageForPath(path: string): string | undefined {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    if (dot <= 0) {
        return undefined;
    }
    return LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase());
}

// Fill a content element with file text, syntax-highlighted when the path names a known language and the vendored hljs global is present; plain text otherwise.
export function renderCodeInto(element: HTMLElement, content: string, path: string): void {
    const language = computeLanguageForPath(path);
    if (language === undefined || typeof hljs === "undefined" || hljs.getLanguage(language) === undefined) {
        element.textContent = content;
        return;
    }
    // hljs HTML-escapes the source text itself, so this is not an injection surface.
    element.innerHTML = hljs.highlight(content, { language, ignoreIllegals: true }).value;
    element.classList.add("hljs");
}

