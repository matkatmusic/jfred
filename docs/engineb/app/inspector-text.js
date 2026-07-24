// Formatted-text mode (TASKS item 21): the human-readable form of a parsed JSONL record —
// message text and tool payloads with real newlines instead of JSON escapes.
// A tool_use block's readable form: a name header plus each STRING input field verbatim under
// a per-field divider — a Write's `content` shows with real newlines instead of JSON escapes.
// Non-string inputs (numbers, arrays) stay in the JSON view; this mode is for reading text.
function extractToolUseText(block) {
    const lines = [`[tool_use: ${block.name}]`];
    for (const [key, value] of Object.entries(block.input ?? {})) {
        if (typeof value !== "string") {
            continue;
        }
        lines.push(`--- ${key} ---`, value);
    }
    return lines.join("\n");
}
// A tool_result block's readable form: its string content, or its nested text blocks joined
// by blank lines (placeholder for nested non-text blocks).
function extractToolResultText(block) {
    if (typeof block.content === "string") {
        return block.content;
    }
    if (!Array.isArray(block.content)) {
        return "[tool_result]";
    }
    return block.content
        .map((inner) => (inner.type === "text" ? inner.text : `[${inner.type}]`))
        .join("\n\n");
}
function extractBlockText(block) {
    if (block.type === "text") {
        return block.text;
    }
    if (block.type === "tool_result") {
        return extractToolResultText(block);
    }
    if (block.type === "tool_use") {
        return extractToolUseText(block);
    }
    return `[${block.type}]`;
}
// The human-readable text of one parsed JSONL record: message text and tool payloads with
// real newlines, blocks joined by blank lines, unknown block kinds as one-line placeholders.
// A non-JSON raw line is already readable and returns verbatim. undefined when the record
// carries no message content (e.g. file-history snapshots) — the caller hides the toggle.
export function extractReadableText(value) {
    if (typeof value === "string") {
        return value;
    }
    const content = value?.message?.content;
    if (content === undefined) {
        return undefined;
    }
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return undefined;
    }
    return content.map((block) => extractBlockText(block)).join("\n\n");
}
