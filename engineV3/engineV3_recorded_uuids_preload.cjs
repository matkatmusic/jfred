// Preloaded by bun and node in a recorded command whose recorded output holds new uuids: randomUUID hands out those uuids in order, then real random ones.

const { mkdirSync } = require("node:fs");
const { join } = require("node:path");
const nodeCrypto = require("node:crypto");
const nodeModule = require("node:module");

const recordedUuids = process.env.ENGINEV3_RECORDED_UUIDS.split(",");
const claimsFolder = process.env.ENGINEV3_RECORDED_UUID_CLAIMS_FOLDER;
const getRealRandomUuid = nodeCrypto.randomUUID;
let nextPosition = 0;

// Only the process whose mkdir makes the claim folder gets a path back, so two processes of one call never share a position.
function claimPosition(position) {
    const createdFolder = mkdirSync(join(claimsFolder, String(position)), { recursive: true });
    return createdFolder !== undefined;
}

function getRecordedOrRandomUuid() {
    while (nextPosition < recordedUuids.length) {
        const position = nextPosition;
        nextPosition += 1;
        if (claimPosition(position)) {
            return recordedUuids[position];
        }
    }
    return getRealRandomUuid();
}

nodeCrypto.randomUUID = getRecordedOrRandomUuid;
globalThis.crypto.randomUUID = getRecordedOrRandomUuid;
// An ESM `import { randomUUID } from "crypto"` reads the builtin's exports only after this sync.
nodeModule.syncBuiltinESMExports();
