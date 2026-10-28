import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { test } from "node:test";
import { BRANCHES, FIXTURE_DIR } from "../src/viewer_api_layer1_fixture_data.ts";
import { buildFixtureSettings, receiveFixtureSettings } from "../src/viewer_api_layer1_fixture_settings.ts";

test("fixture settings name the fixture project as the last folder", () => {
  const settings = buildFixtureSettings();
  assert.equal(settings.lastDir, FIXTURE_DIR);
  assert.equal(settings.projects[FIXTURE_DIR]!.ref, BRANCHES[0]);
});

test("fixture settings POST answers saved once the body ends", () => {
  const request = new EventEmitter();
  let writtenBody = "";
  const response = {
    writeHead: () => response,
    end: (body: string) => {
      writtenBody = body;
    },
  };
  receiveFixtureSettings(request as IncomingMessage, response as unknown as ServerResponse);
  request.emit("data", Buffer.from("{}"));
  request.emit("end");
  assert.deepEqual(JSON.parse(writtenBody), { saved: true });
});
