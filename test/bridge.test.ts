import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  GatewayIdempotencyConflictError,
  HttpRequestError,
  IlinkMediaError,
  IlinkSessionExpiredError,
} from "../src/errors.ts";
import { processUpdateBatch } from "../src/bridge.ts";
import type { PiGateway } from "../src/gateway.ts";
import type { WeixinTransport } from "../src/ilink.ts";
import { configureStore, withTestStore } from "./runtime.ts";

const unusedLogin: WeixinTransport["login"] = () => Effect.never;

it.effect("authorized messages reach Pi once and use deterministic ids for every reply chunk", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      const prompts: string[] = [];
      const replies: Array<{ text: string; clientId: string }> = [];
      const typing: string[] = [];
      const gateway: PiGateway = {
        promptAndWait: (sessionId, requestId, message, images, onProgress) =>
          Effect.gen(function* () {
            expect(sessionId).toBe("pi-session");
            expect(requestId).toMatch(/^[a-f0-9]{64}$/);
            prompts.push(message);
            expect(images).toEqual([]);
            yield* onProgress({
              _tag: "ToolStarted",
              runId: "run-1",
              toolCallId: "tool-1",
              toolName: "browser",
            });
            return "a".repeat(4_001);
          }),
      };
      const transport: WeixinTransport = {
        login: unusedLogin,
        getUpdates: () => Effect.succeed({}),
        startTyping: (_auth, userId) =>
          Effect.sync(() => {
            typing.push("start");
            return { userId, ticket: "ticket" };
          }),
        stopTyping: () => Effect.sync(() => typing.push("stop")),
        notifyStart: () => Effect.void,
        notifyStop: () => Effect.void,
        downloadImage: () => Effect.die("unused image download"),
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
      expect(replies.map((reply) => reply.text)).toEqual([
        "Pi 正在使用工具：browser",
        "a".repeat(4_000),
        "a",
      ]);
      expect(replies[0]?.clientId).toMatch(/^piw-[a-f0-9]{32}$/);
      expect(replies[1]?.clientId).toMatch(/^piw-[a-f0-9]{32}$/);
      expect(new Set(replies.map((reply) => reply.clientId))).toHaveLength(3);
      expect(typing).toEqual(["start", "stop"]);
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
            startTyping: (_auth, userId) => Effect.succeed({ userId, ticket: "ticket" }),
            stopTyping: () => Effect.void,
            notifyStart: () => Effect.void,
            notifyStop: () => Effect.void,
            downloadImage: () => Effect.die("unused image download"),
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

it.effect("stale credentials from typing stop the batch before Pi is prompted", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      let prompted = false;
      const result = yield* processUpdateBatch(
        {
          msgs: [
            {
              message_id: 43,
              message_type: 1,
              from_user_id: "allowed-user",
              context_token: "context",
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
                return "reply";
              }),
          },
          transport: {
            login: unusedLogin,
            getUpdates: () => Effect.succeed({}),
            startTyping: () =>
              Effect.fail(
                new IlinkSessionExpiredError({
                  operation: "ilink.get_config",
                  code: -14,
                  cause: "expired",
                }),
              ),
            stopTyping: () => Effect.void,
            notifyStart: () => Effect.void,
            notifyStop: () => Effect.void,
            downloadImage: () => Effect.die("unused image download"),
            sendText: () => Effect.void,
          },
        },
      ).pipe(Effect.exit);

      expect(result._tag).toBe("Failure");
      expect(prompted).toBe(false);
    }),
  ),
);

it.effect(
  "idempotency conflicts become a terminal user-visible reply instead of a retry loop",
  () =>
    withTestStore((store) =>
      Effect.gen(function* () {
        yield* configureStore(store);
        const replies: string[] = [];
        yield* processUpdateBatch(
          {
            msgs: [
              {
                message_id: 44,
                message_type: 1,
                from_user_id: "allowed-user",
                item_list: [{ type: 1, text_item: { text: "hello" } }],
              },
            ],
          },
          {
            store,
            gateway: {
              promptAndWait: (_sessionId, requestId) =>
                Effect.fail(
                  new GatewayIdempotencyConflictError({
                    sessionId: "pi-session",
                    requestId,
                    reason: "InDoubt",
                  }),
                ),
            },
            transport: {
              login: unusedLogin,
              getUpdates: () => Effect.succeed({}),
              startTyping: (_auth, userId) => Effect.succeed({ userId, ticket: "ticket" }),
              stopTyping: () => Effect.void,
              notifyStart: () => Effect.void,
              notifyStop: () => Effect.void,
              downloadImage: () => Effect.die("unused image download"),
              sendText: (_auth, _to, text) => Effect.sync(() => replies.push(text)),
            },
          },
        );

        expect(replies).toEqual([
          "上一条请求的执行状态无法安全确认。为避免重复执行，已停止自动重试；请检查 Pi 会话后重新发送。",
        ]);
        expect((yield* store.read).processedMessageIds).toContain("message-44");
      }),
    ),
);

it.effect("image-only and mixed messages preserve the prompt identity and image payload", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      const prompts: Array<{
        requestId: string;
        message: string;
        images: ReadonlyArray<{ readonly data: string; readonly mimeType: string }>;
      }> = [];
      const replies: string[] = [];
      const gateway: PiGateway = {
        promptAndWait: (_sessionId, requestId, message, images) =>
          Effect.sync(() => {
            prompts.push({ requestId, message, images });
            return "完成";
          }),
      };
      const transport: WeixinTransport = {
        login: unusedLogin,
        getUpdates: () => Effect.succeed({}),
        startTyping: (_auth, userId) => Effect.succeed({ userId, ticket: "ticket" }),
        stopTyping: () => Effect.void,
        notifyStart: () => Effect.void,
        notifyStop: () => Effect.void,
        downloadImage: (image) =>
          Effect.succeed({
            data: image.media?.encrypt_query_param ?? "missing",
            mimeType: "image/png",
          }),
        sendText: (_auth, _to, text) => Effect.sync(() => replies.push(text)),
      };

      yield* processUpdateBatch(
        {
          msgs: [
            {
              message_id: 45,
              message_type: 1,
              from_user_id: "allowed-user",
              item_list: [
                { type: 2, image_item: { media: { encrypt_query_param: "image-only" } } },
              ],
            },
            {
              message_id: 46,
              message_type: 1,
              from_user_id: "allowed-user",
              item_list: [
                { type: 1, text_item: { text: "描述图片" } },
                { type: 2, image_item: { media: { encrypt_query_param: "mixed" } } },
              ],
            },
          ],
        },
        { store, transport, gateway },
      );

      expect(prompts).toEqual([
        {
          requestId: "message-45",
          message: "请分析这些图片。",
          images: [{ data: "image-only", mimeType: "image/png" }],
        },
        {
          requestId: "message-46",
          message: "描述图片",
          images: [{ data: "mixed", mimeType: "image/png" }],
        },
      ]);
      expect(replies).toEqual(["完成", "完成"]);
    }),
  ),
);

it.effect("permanent image errors reply once and become processed", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      const replies: string[] = [];
      let prompted = false;
      const transport: WeixinTransport = {
        login: unusedLogin,
        getUpdates: () => Effect.succeed({}),
        startTyping: () => Effect.die("typing must not start"),
        stopTyping: () => Effect.die("typing must not stop"),
        notifyStart: () => Effect.void,
        notifyStop: () => Effect.void,
        downloadImage: () =>
          Effect.fail(
            new IlinkMediaError({
              operation: "decrypt",
              reason: "InvalidKey",
              cause: "bad key",
            }),
          ),
        sendText: (_auth, _to, text) => Effect.sync(() => replies.push(text)),
      };
      const gateway: PiGateway = {
        promptAndWait: () =>
          Effect.sync(() => {
            prompted = true;
            return "unexpected";
          }),
      };
      const response = {
        msgs: [
          {
            message_id: 47,
            message_type: 1,
            from_user_id: "allowed-user",
            item_list: [{ type: 2, image_item: { aeskey: "bad" } }],
          },
        ],
      };

      yield* processUpdateBatch(response, { store, transport, gateway });
      yield* processUpdateBatch(response, { store, transport, gateway });

      expect(prompted).toBe(false);
      expect(replies).toEqual(["图片下载或解密失败，请重新发送原图。"]);
      expect((yield* store.read).processedMessageIds).toContain("message-47");
    }),
  ),
);

it.effect("transient image download failures remain unprocessed for retry", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      let replied = false;
      const result = yield* processUpdateBatch(
        {
          msgs: [
            {
              message_id: 48,
              message_type: 1,
              from_user_id: "allowed-user",
              item_list: [{ type: 2, image_item: { media: { encrypt_query_param: "retry" } } }],
            },
          ],
        },
        {
          store,
          gateway: { promptAndWait: () => Effect.die("Pi must not be prompted") },
          transport: {
            login: unusedLogin,
            getUpdates: () => Effect.succeed({}),
            startTyping: () => Effect.die("typing must not start"),
            stopTyping: () => Effect.die("typing must not stop"),
            notifyStart: () => Effect.void,
            notifyStop: () => Effect.void,
            downloadImage: () =>
              Effect.fail(
                new HttpRequestError({
                  operation: "ilink.download_image",
                  url: "https://novac2c.cdn.weixin.qq.com/c2c/download",
                  cause: "connection reset",
                }),
              ),
            sendText: () =>
              Effect.sync(() => {
                replied = true;
              }),
          },
        },
      ).pipe(Effect.exit);

      expect(result._tag).toBe("Failure");
      expect(replied).toBe(false);
      expect((yield* store.read).processedMessageIds).not.toContain("message-48");
    }),
  ),
);

it.effect("untranscribed Weixin voice gets one friendly terminal reply", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* configureStore(store);
      const replies: string[] = [];
      let prompted = false;
      const response = {
        msgs: [
          {
            message_id: 49,
            message_type: 1,
            from_user_id: "allowed-user",
            item_list: [{ type: 3, voice_item: { media: {} } }],
          },
        ],
      };
      const transport: WeixinTransport = {
        login: unusedLogin,
        getUpdates: () => Effect.succeed({}),
        startTyping: () => Effect.die("typing must not start"),
        stopTyping: () => Effect.die("typing must not stop"),
        notifyStart: () => Effect.void,
        notifyStop: () => Effect.void,
        downloadImage: () => Effect.die("image download must not start"),
        sendText: (_auth, _to, text) => Effect.sync(() => replies.push(text)),
      };
      const gateway: PiGateway = {
        promptAndWait: () =>
          Effect.sync(() => {
            prompted = true;
            return "unexpected";
          }),
      };

      yield* processUpdateBatch(response, { store, transport, gateway });
      yield* processUpdateBatch(response, { store, transport, gateway });

      expect(prompted).toBe(false);
      expect(replies).toEqual(["微信暂时没能识别这条语音，请重新发送语音，或直接发送文字。"]);
      expect((yield* store.read).processedMessageIds).toContain("message-49");
    }),
  ),
);
