// Task 382: one CSS class and one label letter per session record kind; the CSS owner styles the shapes.

import { WireRecordKind } from "./layer1-wire-annotations.ts";

export interface AnnotationLook {
  cssClass: string;
  letter: string;
}

export const ANNOTATION_LOOKS: Record<WireRecordKind, AnnotationLook> = {
  [WireRecordKind.user]: { cssClass: "a-user", letter: "[u]" },
  [WireRecordKind.assistant]: { cssClass: "a-assistant", letter: "[a]" },
  [WireRecordKind.toolUse]: { cssClass: "a-tool-use", letter: "[t]" },
  [WireRecordKind.toolResult]: { cssClass: "a-tool-result", letter: "[r]" },
  [WireRecordKind.attachment]: { cssClass: "a-attachment", letter: "[h]" },
  [WireRecordKind.permissionMode]: { cssClass: "a-permission-mode", letter: "[m]" },
  [WireRecordKind.customTitle]: { cssClass: "a-custom-title", letter: "[n]" },
  [WireRecordKind.unknown]: { cssClass: "a-unknown", letter: "[?]" },
};
