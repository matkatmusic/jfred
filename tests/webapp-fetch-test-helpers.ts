// Global fetch stubs for webapp DOM tests: canned JSON routes, canned NDJSON streams, and forwarding to a live server.

// Captured before any test replaces fetch; forwarding through a later stub would return canned 404s.
const NATIVE_FETCH = globalThis.fetch;

// A minimal Response-like object covering exactly what fetchLogged reads: ok/status/json/text.
function buildJsonResponse(payload: unknown, ok: boolean, status: number): Response {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => (ok ? "" : "pathname not stubbed by stubFetchRoutes"),
  } as unknown as Response;
}

// The stubbed fetch: canned JSON keyed by pathname, ignoring query strings; unknown pathnames answer 404 naming the gap loudly.
function buildStubbedFetch(routesByPathname: Record<string, unknown>): (url: unknown) => Promise<Response> {
  return async (url: unknown): Promise<Response> => {
    const { pathname } = new URL(String(url), "http://localhost:7343");
    if (pathname in routesByPathname) {
      return buildJsonResponse(routesByPathname[pathname], true, 200);
    }
    return buildJsonResponse({}, false, 404);
  };
}

// Replace global fetch for the duration of a test with the canned-route stub above.
export function stubFetchRoutes(routesByPathname: Record<string, unknown>): void {
  Object.assign(globalThis, { fetch: buildStubbedFetch(routesByPathname) });
}

// A Response streaming real NDJSON for pages reading progress (Layer 1's `?progress=1` path).
function buildStreamStarter(encoded: Uint8Array): (controller: ReadableStreamDefaultController) => void {
  return (controller) => {
    controller.enqueue(encoded);
    controller.close();
  };
}

function buildNdjsonResponse(lines: unknown[]): Response {
  const serializedLines: string[] = [];
  for (const line of lines) {
    serializedLines.push(JSON.stringify(line));
  }
  const encoded = new TextEncoder().encode(serializedLines.join("\n") + "\n");
  const body = new ReadableStream({ start: buildStreamStarter(encoded) });
  return { ok: true, status: 200, body, text: async () => "" } as unknown as Response;
}

function buildStubbedStreamFetch(pathname: string, lines: unknown[]): (url: unknown) => Promise<Response> {
  return async (url: unknown): Promise<Response> => {
    const matched = new URL(String(url), "http://localhost:7343").pathname === pathname;
    return matched ? buildNdjsonResponse(lines) : buildJsonResponse({}, false, 404);
  };
}

// Replace global fetch with one answering `pathname` with a canned NDJSON stream, ignoring query strings like stubFetchRoutes.
export function stubStreamRoute(pathname: string, lines: unknown[]): void {
  Object.assign(globalThis, { fetch: buildStubbedStreamFetch(pathname, lines) });
}

// Task 238 (spec S18): route relative fetches to a live server; node fetch rejects relative urls.
export function installOriginForwardingFetch(origin: string): void {
  Object.assign(globalThis, {
    fetch: (url: unknown, options?: RequestInit): Promise<Response> =>
      NATIVE_FETCH(new URL(String(url), origin), options),
  });
}
