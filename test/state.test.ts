import { expect, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { withTestStore } from "./runtime.ts";

it.effect("state store persists auth and bounds processed ids", () =>
  withTestStore(
    (store) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        yield* store.saveAuth({
          token: "secret",
          baseUrl: "https://example.test",
          accountId: "bot",
          userId: "user",
          savedAt: "now",
        });
        yield* store.bind({ sessionId: "session", cwd: "/tmp" });
        yield* store.markProcessed("one");
        yield* store.markProcessed("two");
        yield* store.markProcessed("three");

        const state = yield* store.read;
        const info = yield* fs.stat(store.path);
        const encoded = yield* fs.readFileString(store.path);
        expect(state.processedMessageIds).toEqual(["two", "three"]);
        expect(info.mode & 0o777).toBe(0o600);
        expect(encoded).not.toMatch(/\.tmp/);
      }),
    2,
  ),
);
