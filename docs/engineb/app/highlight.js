// File extension -> highlight.js language name; undefined = render as plain text.
const LANGUAGE_BY_EXTENSION = new Map([
    ["py", "python"], ["ts", "typescript"], ["tsx", "typescript"],
    ["js", "javascript"], ["mjs", "javascript"], ["cjs", "javascript"], ["jsx", "javascript"],
    ["json", "json"], ["md", "markdown"], ["css", "css"], ["html", "xml"],
    ["sh", "bash"], ["bash", "bash"], ["zsh", "bash"], ["yml", "yaml"], ["yaml", "yaml"],
]);
// The highlight.js language for a file path, from its extension; undefined for unknown
// extensions and extensionless paths.
export function computeLanguageForPath(path) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    if (dot <= 0) {
        return undefined;
    }
    return LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase());
}
// Fill a content element with file text, syntax-highlighted when the path names a known
// language and the vendored hljs global is present; plain text otherwise.
export function renderCodeInto(element, content, path) {
    const language = computeLanguageForPath(path);
    if (language === undefined || typeof hljs === "undefined" || hljs.getLanguage(language) === undefined) {
        element.textContent = content;
        return;
    }
    // hljs HTML-escapes the source text itself, so this is not an injection surface.
    element.innerHTML = hljs.highlight(content, { language, ignoreIllegals: true }).value;
    element.classList.add("hljs");
}
