// Task 17 — static-data shim for the Engine-B GitHub Pages demo. Loaded as a CLASSIC script
// BEFORE app.js (a module script, so it always runs later), this monkey-patches window.fetch to
// answer every /api/* request from the canned files under data/ that
// scripts/generate_pages_demo_data.ts wrote. No webapp code is forked: the real localhost app
// stays untouched, and this file is the demo's only runtime addition.
(() => {
    const realFetch = window.fetch.bind(window);

    const notAvailable = (routeName) => new Response(
        "not available in the static demo: " + routeName,
        { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );

    // A canned JSON file, served with the same content type the live server uses.
    async function serveDataFile(relativePath, contentType) {
        const response = await realFetch("data/" + relativePath);
        if (!response.ok) {
            return notAvailable(relativePath + " (missing canned file)");
        }
        const text = await response.text();
        return new Response(text, { status: 200, headers: { "Content-Type": contentType } });
    }

    const serveJson = (relativePath) => serveDataFile(relativePath, "application/json; charset=utf-8");

    // /api/blob mirrors readBlobSnapshot's wire shape: always 200 with an `exists` flag.
    async function serveBlob(query) {
        const session = query.get("session") ?? "";
        const name = query.get("name") ?? "";
        const response = await realFetch("data/blobs/" + encodeURIComponent(session) + "/" + encodeURIComponent(name));
        const payload = response.ok
            ? { exists: true, content: await response.text() }
            : { exists: false };
        return new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" },
        });
    }

    // /api/document streams NDJSON whose final newline-terminated line is the document; the
    // canned document.json is exactly that one line, so its bytes ARE the whole stream.
    const serveDocument = () => serveDataFile("document.json", "application/x-ndjson; charset=utf-8");

    async function serveApiRoute(pathname, query, init) {
        if (pathname === "/api/config") {
            return (init && init.method === "POST") ? notAvailable("POST /api/config") : serveJson("config.json");
        }
        if (pathname === "/api/projects") {
            return serveJson("projects.json");
        }
        if (pathname === "/api/project-paths") {
            return (init && init.method === "POST") ? notAvailable("POST /api/project-paths") : serveJson("project-paths.json");
        }
        if (pathname === "/api/prescan") {
            return serveJson("prescan.json");
        }
        if (pathname === "/api/document") {
            // Bounded-mode params are ignored on purpose: the canned build is the full
            // consented document, a superset of any bounded request.
            return serveDocument();
        }
        if (pathname === "/api/raw") {
            return serveDataFile("raw/" + encodeURIComponent(query.get("jsonl") ?? ""), "text/plain; charset=utf-8");
        }
        if (pathname === "/api/blob") {
            return serveBlob(query);
        }
        return notAvailable(pathname);
    }

    window.fetch = (input, init) => {
        const url = new URL(typeof input === "string" ? input : input.url, location.href);
        if (!url.pathname.startsWith("/api/")) {
            return realFetch(input, init);
        }
        return serveApiRoute(url.pathname, url.searchParams, init);
    };
})();
