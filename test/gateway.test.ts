import { expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import { makePiGateway } from "../src/gateway.ts";
import type { JsonHttpClient, JsonHttpRequest } from "../src/http.ts";

it.effect("gateway submits a blocking prompt to the loopback pi-web host", () =>
  Effect.gen(function* () {
    let captured: JsonHttpRequest | undefined;
    const http: JsonHttpClient = {
      request: (request) =>
        Effect.sync(() => {
          captured = request;
          return { success: true, data: { text: "reply" } };
        }),
    };
    const gateway = yield* makePiGateway(http, "http://127.0.0.1:30141");
    const reply = yield* gateway.promptAndWait("session/id", "hello");

    expect(reply).toBe("reply");
    expect(captured?.url).toBe("http://127.0.0.1:30141/api/agent/session%2Fid");
    expect(captured?.body).toEqual({
      type: "prompt_and_wait",
      message: "hello",
    });
  }),
);

it.effect("gateway rejects non-loopback hosts", () =>
  Effect.gen(function* () {
    const result = yield* makePiGateway(
      { request: () => Effect.succeed({}) },
      "https://example.com",
    ).pipe(Effect.exit);
    expect(Exit.isFailure(result)).toBe(true);
  }),
);
