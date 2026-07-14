import { Effect, Schema } from "effect";
import { BridgeConfigurationError, GatewayError } from "./errors.ts";
import type { JsonHttpClient } from "./http.ts";
import { PiGatewayResponseSchema } from "./schema.ts";

export interface PiGateway {
  readonly promptAndWait: (
    sessionId: string,
    message: string,
  ) => Effect.Effect<string, GatewayError>;
}

const requireLoopbackBaseUrl = (input: string): Effect.Effect<URL, BridgeConfigurationError> =>
  Effect.gen(function* () {
    const url = yield* Effect.try({
      try: () => new URL(input),
      catch: () => new BridgeConfigurationError({ reason: "PI_WEB_BASE_URL is not a valid URL" }),
    });
    const loopback =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "http:" || !loopback) {
      return yield* new BridgeConfigurationError({
        reason: "PI_WEB_BASE_URL must be an http loopback URL",
      });
    }
    return url;
  });

export const makePiGateway = (
  http: JsonHttpClient,
  baseUrl: string,
): Effect.Effect<PiGateway, BridgeConfigurationError> =>
  Effect.gen(function* () {
    const root = yield* requireLoopbackBaseUrl(baseUrl);
    return {
      promptAndWait: (sessionId, message) =>
        Effect.gen(function* () {
          const endpoint = new URL(`/api/agent/${encodeURIComponent(sessionId)}`, root).toString();
          const raw = yield* http
            .request({
              operation: "pi.prompt_and_wait",
              method: "POST",
              url: endpoint,
              headers: { "Content-Type": "application/json" },
              body: {
                type: "prompt_and_wait",
                message,
              },
            })
            .pipe(Effect.mapError((cause) => new GatewayError({ sessionId, cause })));
          const response = yield* Schema.decodeUnknownEffect(PiGatewayResponseSchema)(raw).pipe(
            Effect.mapError((cause) => new GatewayError({ sessionId, cause })),
          );
          if (response.error !== undefined) {
            return yield* new GatewayError({ sessionId, cause: response.error });
          }
          const text = response.data?.text;
          return typeof text === "string" && text ? text : "（Pi 无文本回复）";
        }).pipe(Effect.withSpan("pi_weixin.gateway.prompt")),
    };
  });
