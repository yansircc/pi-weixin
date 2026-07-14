import { expect, it } from "@effect/vitest";
import { extractText, messageIdentity, replyClientId } from "../src/message.ts";

it("message identity is independent of object key order", () => {
  const left = {
    from_user_id: "u1",
    message_type: 1,
    item_list: [{ type: 1, text_item: { text: "hi" } }],
  };
  const right = {
    item_list: [{ text_item: { text: "hi" }, type: 1 }],
    message_type: 1,
    from_user_id: "u1",
  };
  expect(messageIdentity(left)).toBe(messageIdentity(right));
  expect(replyClientId(messageIdentity(left))).toBe(replyClientId(messageIdentity(right)));
});

it("text extraction joins all text items and ignores other media", () => {
  expect(
    extractText({
      item_list: [
        { type: 1, text_item: { text: " first " } },
        { type: 2 },
        { type: 1, text_item: { text: "second" } },
      ],
    }),
  ).toBe("first\nsecond");
});
