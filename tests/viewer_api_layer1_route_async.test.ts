// Part P: sendNdjsonAsync writes the step's lines, ends with its value, reports a failure, and aborts on close.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, get as sendHttpGet, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { sendNdjsonAsync, type NdjsonStep } from "../src/viewer_api_layer1_route_async.ts";

let server: Server;
let port: number;
let currentStep: NdjsonStep;

before(async () => {
    server = createServer((_request, response) => {
        void sendNdjsonAsync(response, currentStep);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
});

after(() => {
    server.close();
});

function readReply(): Promise<{ contentType: string; text: string }> {
    return new Promise((resolve) => {
        sendHttpGet({ host: "127.0.0.1", port }, (response) => {
            let text = "";
            response.on("data", (chunk: Buffer) => {
                text += chunk.toString();
            });
            response.on("end", () => resolve({ contentType: String(response.headers["content-type"]), text }));
        });
    });
}

test("test_sendNdjsonAsync_writes_each_line_then_the_returned_value", async () => {
    currentStep = async (writeLine) => {
        writeLine({ n: 1 });
        writeLine({ n: 2 });
        return { n: 3 };
    };
    const reply = await readReply();
    assert.match(reply.contentType, /application\/x-ndjson/);
    assert.equal(reply.text, '{"n":1}\n{"n":2}\n{"n":3}\n');
});

test("test_sendNdjsonAsync_writes_no_last_line_when_the_step_returns_undefined", async () => {
    currentStep = async (writeLine) => {
        writeLine({ n: 1 });
        return undefined;
    };
    assert.equal((await readReply()).text, '{"n":1}\n');
});

test("test_sendNdjsonAsync_turns_a_failure_after_the_header_into_an_error_line", async () => {
    currentStep = async (writeLine) => {
        writeLine({ n: 1 });
        throw new Error("boom");
    };
    assert.equal((await readReply()).text, '{"n":1}\n{"kind":"error","label":"boom"}\n');
});

test("test_sendNdjsonAsync_aborts_the_signal_when_the_client_closes", async () => {
    let startStep: () => void = () => {};
    const stepStarted = new Promise<void>((resolve) => {
        startStep = resolve;
    });
    const sawAbort = new Promise<boolean>((resolve) => {
        currentStep = async (writeLine, signal) => {
            writeLine({ n: 1 });
            startStep();
            await new Promise((done) => signal.addEventListener("abort", done));
            resolve(signal.aborted);
            return undefined;
        };
    });
    const request = sendHttpGet({ host: "127.0.0.1", port }, () => {});
    request.on("error", () => {});
    await stepStarted;
    request.destroy();
    assert.equal(await sawAbort, true);
});
