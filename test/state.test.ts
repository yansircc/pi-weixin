import { expect, it } from "@effect/vitest";
import { Effect, Exit, FileSystem } from "effect";
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

it.effect("clearing stale credentials preserves the session binding and enabled intent", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      yield* store.saveAuth({
        token: "stale",
        baseUrl: "https://example.test",
        accountId: "bot",
        userId: "user",
        savedAt: "now",
      });
      yield* store.bind({ sessionId: "session", cwd: "/tmp" });
      yield* store.saveCursor("cursor");
      yield* store.markProcessed("message-1");

      const state = yield* store.clearAuth;
      expect(state.auth).toBeUndefined();
      expect(state.binding?.sessionId).toBe("session");
      expect(state.enabled).toBe(true);
      expect(state.cursor).toBe("");
      expect(state.processedMessageIds).toEqual([]);
    }),
  ),
);

it.effect("rejects the removed v1 state shape instead of migrating it", () =>
  withTestStore((store) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(
        store.path,
        JSON.stringify({
          version: 1,
          enabled: false,
          cursor: "",
          processedMessageIds: [],
        }),
      );
      expect(Exit.isFailure(yield* Effect.exit(store.read))).toBe(true);
    }),
  ),
);
