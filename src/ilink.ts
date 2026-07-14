import { Clock, DateTime, Effect, Random, Schema } from "effect";
import { HttpRequestError, IlinkProtocolError } from "./errors.ts";
import type { JsonHttpClient } from "./http.ts";
import {
  LoginQrResponseSchema,
  LoginStatusResponseSchema,
  UpdatesResponseSchema,
  type UpdatesResponse,
  type WeixinAuth,
} from "./schema.ts";

const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
const BOT_TYPE = "3";
const CHANNEL_VERSION = "1.0.2";

export interface LoginCallbacks<E> {
  readonly onQr: (content: string) => Effect.Effect<void, E>;
  readonly onStatus?: (message: string) => Effect.Effect<void>;
}

export interface WeixinTransport {
  readonly login: <E>(
    callbacks: LoginCallbacks<E>,
  ) => Effect.Effect<WeixinAuth, E | HttpRequestError | IlinkProtocolError>;
  readonly getUpdates: (
    auth: WeixinAuth,
    cursor: string,
  ) => Effect.Effect<UpdatesResponse, HttpRequestError | IlinkProtocolError>;
  readonly sendText: (
    auth: WeixinAuth,
    toUserId: string,
    text: string,
    contextToken: string,
    clientId: string,
  ) => Effect.Effect<void, HttpRequestError | IlinkProtocolError>;
}

const protocolError = (operation: string) => (cause: unknown) =>
  new IlinkProtocolError({ operation, cause });

const requireSuccess = <A extends { readonly ret?: number | undefined }>(
  operation: string,
  value: A,
): Effect.Effect<A, IlinkProtocolError> =>
  value.ret !== undefined && value.ret !== 0
    ? Effect.fail(protocolError(operation)(`iLink ret=${value.ret}`))
    : Effect.succeed(value);

const requireText = (operation: string, field: string, value: string | undefined) =>
  value ? Effect.succeed(value) : Effect.fail(protocolError(operation)(`Missing ${field}`));

export const makeIlinkClient = (http: JsonHttpClient): WeixinTransport => {
  const post = (
    operation: string,
    baseUrl: string,
    endpoint: string,
    token: string,
    body: Readonly<Record<string, unknown>>,
    timeout?: `${number} millis` | `${number} seconds`,
  ) =>
    Effect.gen(function* () {
      const uin = yield* Random.nextIntBetween(0, 0xffff_ffff);
      return yield* http.request({
        operation,
        method: "POST",
        url: `${baseUrl.replace(/\/$/, "")}/${endpoint}`,
        headers: {
          "Content-Type": "application/json",
          AuthorizationType: "ilink_bot_token",
          Authorization: `Bearer ${token}`,
          "X-WECHAT-UIN": Buffer.from(String(uin), "utf8").toString("base64"),
        },
        body: { ...body, base_info: { channel_version: CHANNEL_VERSION } },
        ...(timeout ? { timeout } : {}),
      });
    });

  const getLoginQr = Effect.gen(function* () {
    const raw = yield* http.request({
      operation: "ilink.login.qr",
      method: "GET",
      url: `${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=${BOT_TYPE}`,
    });
    const decoded = yield* Schema.decodeUnknownEffect(LoginQrResponseSchema)(raw).pipe(
      Effect.mapError(protocolError("ilink.login.qr")),
    );
    return yield* requireSuccess("ilink.login.qr", decoded);
  });

  return {
    login: <E>(callbacks: LoginCallbacks<E>) =>
      Effect.gen(function* () {
        const first = yield* getLoginQr;
        yield* callbacks.onQr(first.qrcode_img_content);
        yield* callbacks.onStatus?.("等待微信扫码") ?? Effect.void;
        const startedAt = yield* Clock.currentTimeMillis;
        const deadline = startedAt + 5 * 60_000;

        const poll = (
          code: string,
          refreshes: number,
        ): Effect.Effect<WeixinAuth, E | HttpRequestError | IlinkProtocolError> =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            if (now >= deadline) return yield* protocolError("ilink.login")("微信登录超时");

            const raw = yield* http.request({
              operation: "ilink.login.status",
              method: "GET",
              url: `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(code)}`,
            });
            const status = yield* Schema.decodeUnknownEffect(LoginStatusResponseSchema)(raw).pipe(
              Effect.mapError(protocolError("ilink.login.status")),
              Effect.flatMap((value) => requireSuccess("ilink.login.status", value)),
            );

            if (status.status === "confirmed") {
              const token = yield* requireText("ilink.login", "bot_token", status.bot_token);
              const accountId = yield* requireText(
                "ilink.login",
                "ilink_bot_id",
                status.ilink_bot_id,
              );
              const userId = yield* requireText(
                "ilink.login",
                "ilink_user_id",
                status.ilink_user_id,
              );
              const savedAt = DateTime.formatIso(yield* DateTime.now);
              return {
                token,
                baseUrl: status.baseurl ?? DEFAULT_BASE_URL,
                accountId,
                userId,
                savedAt,
              };
            }

            if (status.status === "expired") {
              if (refreshes >= 3) return yield* protocolError("ilink.login")("微信二维码多次过期");
              const next = yield* getLoginQr;
              yield* callbacks.onQr(next.qrcode_img_content);
              yield* Effect.sleep("1 second");
              return yield* poll(next.qrcode, refreshes + 1);
            }

            if (status.status === "scaned") {
              yield* callbacks.onStatus?.("已扫码，请在微信确认") ?? Effect.void;
            }
            yield* Effect.sleep("1 second");
            return yield* poll(code, refreshes);
          });

        return yield* poll(first.qrcode, 0);
      }),

    getUpdates: (auth, cursor) =>
      post(
        "ilink.get_updates",
        auth.baseUrl,
        "ilink/bot/getupdates",
        auth.token,
        { get_updates_buf: cursor },
        "38 seconds",
      ).pipe(
        Effect.catchTag("HttpRequestError", (error) =>
          error.cause === "timeout"
            ? Effect.succeed({ ret: 0, msgs: [], get_updates_buf: cursor })
            : Effect.fail(error),
        ),
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(UpdatesResponseSchema)(raw).pipe(
            Effect.mapError(protocolError("ilink.get_updates")),
          ),
        ),
        Effect.flatMap((value) => requireSuccess("ilink.get_updates", value)),
      ),

    sendText: (auth, toUserId, text, contextToken, clientId) =>
      post(
        "ilink.send_text",
        auth.baseUrl,
        "ilink/bot/sendmessage",
        auth.token,
        {
          msg: {
            from_user_id: "",
            to_user_id: toUserId,
            client_id: clientId,
            message_type: 2,
            message_state: 2,
            context_token: contextToken,
            item_list: [{ type: 1, text_item: { text } }],
          },
        },
        "15 seconds",
      ).pipe(
        Effect.flatMap((raw) =>
          Schema.decodeUnknownEffect(
            Schema.Struct({
              ret: Schema.optional(Schema.Number),
            }),
          )(raw).pipe(Effect.mapError(protocolError("ilink.send_text"))),
        ),
        Effect.flatMap((value) => requireSuccess("ilink.send_text", value)),
        Effect.asVoid,
      ),
  };
};
