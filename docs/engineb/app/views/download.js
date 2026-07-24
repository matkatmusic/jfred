// Shared browser download helper: put `text` on disk as `fileName` via a transient object URL.
// Lifted from file-history.js so the timeline view reuses it instead of duplicating.
export function downloadText(fileName, text) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}
