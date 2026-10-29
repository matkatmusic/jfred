// Wire shapes and the DOM-free view model for the conversation view, tested against scenario ground truth.

// Wire shapes of the /api/document JSON this view reads; ids, paths, and dates arrive as plain strings.
export type WireConversationMessage = {
  uuid: string;
  role: string;
  timestamp?: string;
  text: string;
};
export type WireLineVerdict = {
  uuid: string;
  line: number;
  type: string;
  verdict: string;
};
export type WireBranch = {
  isSurviving: boolean;
  tip: string;
};
export type WireFileHistory = {
  target: string;
  revisions: { changeId: string }[];
};
export type WireConversationDocument = {
  messages: WireConversationMessage[];
  lineVerdicts: WireLineVerdict[];
  branches: WireBranch[];
  filesTouched: WireFileHistory[];
};
// Fields exclusive to one member are `?: undefined` on the other so union-wide reads typecheck without narrowing.
export type ConversationStubEntry = { kind: "stub"; line: number; uuid: string; type: string; verdict: string; message?: undefined };
export type ConversationEntry =
    | { kind: "message"; message: WireConversationMessage; line?: undefined; uuid?: undefined; type?: undefined; verdict?: undefined }
    | ConversationStubEntry;

// Walks lineVerdicts in line order: a message uuid gives a message entry, any other line a stub.
export function buildConversationViewModel(document: WireConversationDocument): { entries: ConversationEntry[] } {
  const messageByUuid = new Map<string, WireConversationMessage>();
  for (const message of document.messages) {
    messageByUuid.set(message.uuid, message);
  }
  const entries: ConversationEntry[] = [];
  for (const verdict of document.lineVerdicts) {
    const message = messageByUuid.get(verdict.uuid);
    if (message !== undefined) {
      entries.push({ kind: "message", message });
    }
    else {
      entries.push({ kind: "stub", line: verdict.line, uuid: verdict.uuid, type: verdict.type, verdict: verdict.verdict });
    }
  }
  return { entries };
}
