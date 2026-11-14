import type { BarFileModel } from "./layer1-bars-model.ts";

// GET /api/layer1-inverse-state. Returns reply.text, or "" when text is null.
export function fetchInverseStateText(projectDir: string, path: string, atInstant: string): Promise<string> {
    throw new Error("not built: fetchInverseStateText");
}
// Opens the DetailsPane for one dot: target = state at the dot's instant, base = state at the next older commit's instant.
export function openBarDotDetails(model: BarFileModel, dotIndex: number, projectDir: string): void {
    throw new Error("not built: openBarDotDetails");
}
// Picks the first dot with rowIndex >= selectedRowIndex and opens it like openBarDotDetails. No such dot: shows "File did not exist at this row."
export function openBarFileDetails(model: BarFileModel, selectedRowIndex: number, projectDir: string): void {
    throw new Error("not built: openBarFileDetails");
}
