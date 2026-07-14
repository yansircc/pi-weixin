import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { processUpdateBatch } from "../src/bridge.ts";
import type { PiGateway } from "../src/gateway.ts";
import type { WeixinTransport } from "../src/ilink.ts";
import { configureStore, withTestStore } from "./runtime.ts";

const unusedLogin: WeixinTransport["login"] = () => Effect.never;

it.effect("authorized messages reach Pi once and reuse a deterministic reply id", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      const prompts: string[] = [];
      const replies: Array<{ text: string; clientId: string }> = [];
      const gateway: PiGateway = {
        promptAndWait: (sessionId, message) =>
          Effect.sync(() => {
            expect(sessionId).toBe("pi-session");
            prompts.push(message);
            return "Pi reply";
          }),
      };
      const transport: WeixinTransport = {
        login: unusedLogin,
        getUpdates: () => Effect.succeed({}),
        sendText: (_auth, _to, text, _context, clientId) =>
          Effect.sync(() => {
            replies.push({ text, clientId });
          }),
      };
      const response = {
        get_updates_buf: "cursor-2",
        msgs: [
          {
            message_type: 1,
            from_user_id: "allowed-user",
            context_token: "context",
            item_list: [{ type: 1, text_item: { text: "hello" } }],
          },
        ],
      };

      yield* processUpdateBatch(response, { store, transport, gateway });
      yield* processUpdateBatch(response, { store, transport, gateway });

      expect(prompts).toEqual(["hello"]);
      expect(replies).toHaveLength(1);
      expect(replies[0]?.text).toBe("Pi reply");
      expect(replies[0]?.clientId).toMatch(/^piw-[a-f0-9]{32}$/);
      expect((yield* store.read).cursor).toBe("cursor-2");
    }),
  ),
);

it.effect("messages from an unbound user are acknowledged without reaching Pi", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      let prompted = false;
      let replied = false;
      yield* processUpdateBatch(
        {
          get_updates_buf: "cursor-unauthorized",
          msgs: [
            {
              message_type: 1,
              from_user_id: "other-user",
              item_list: [{ type: 1, text_item: { text: "hello" } }],
            },
          ],
        },
        {
          store,
          gateway: {
            promptAndWait: () =>
              Effect.sync(() => {
                prompted = true;
                return "";
              }),
          },
          transport: {
            login: unusedLogin,
            getUpdates: () => Effect.succeed({}),
            sendText: () =>
              Effect.sync(() => {
                replied = true;
              }),
          },
        },
      );

      const state = yield* store.read;
      expect(prompted).toBe(false);
      expect(replied).toBe(false);
      expect(state.cursor).toBe("cursor-unauthorized");
      expect(state.processedMessageIds).toHaveLength(1);
    }),
  ),
);
