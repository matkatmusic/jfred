// Shared fixtures for the layer1-settings tests: one saved project and a stubbed settings route.

export const SAVED_PROJECT = {
  dir: "/Users/you/code/demo-app",
  repo: "/Users/you/code/demo-app",
  branch: "main",
  ref: "",
  jsonl: ["/Users/you/.claude/projects/-Users-you-code-demo-app"],
  fileHistory: ["/Users/you/.claude/file-history"],
};

function buildResponse(body: unknown, ok: boolean, text: string): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => text } as unknown as Response;
}

// Records every POST body so the save's payload can be asserted, and answers GET with `savedFile`.
export function createSettingsRouteStub(savedFile: unknown, saveSucceeds: boolean): { posted: () => unknown[] } {
  const posted: unknown[] = [];
  const fetchStubbed = async (_url: unknown, init?: { method?: string; body?: string }): Promise<Response> => {
    if (init?.method !== "POST") {
      return buildResponse(savedFile, true, "");
    }
    posted.push(JSON.parse(init.body ?? "{}"));
    return buildResponse({ saved: saveSucceeds }, saveSucceeds, "disk full");
  };
  Object.assign(globalThis, { fetch: fetchStubbed });
  return { posted: () => posted };
}

export async function waitForSettle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
