// Boot's last step for a shared link: open its node, ticking the Edit and script boxes if needed.

import { markEditAndScriptRunBoxesChecked } from "./layer1-kind-buttons.ts";
import { findNodeByIdentity, openLinkedNode, type NodeLinkIdentity } from "./layer1-node-link.ts";

// Edit and script nodes load on demand, so a linked one is missing until the [4] boxes are ticked.
export async function openLinkedNodeAfterLoad(identity: NodeLinkIdentity): Promise<void> {
  const isNodeMissing = findNodeByIdentity(document, identity) === undefined;
  if (isNodeMissing) {
    await markEditAndScriptRunBoxesChecked();
  }
  await openLinkedNode(identity);
}
