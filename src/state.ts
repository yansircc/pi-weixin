import { Clock, Effect, FileSystem, Path, Random, Schema, Semaphore } from "effect";
import { StateStoreError } from "./errors.ts";
import {
  BridgeStateJsonSchema,
  type BridgeState,
  type SessionBinding,
  type WeixinAuth,
} from "./schema.ts";

export const EMPTY_STATE: BridgeState = {
  version: 1,
  enabled: false,
  cursor: "",
  processedMessageIds: [],
};

export interface StateStore {
  readonly path: string;
  readonly read: Effect.Effect<BridgeState, StateStoreError>;
  readonly write: (state: BridgeState) => Effect.Effect<void, StateStoreError>;
  readonly saveAuth: (auth: WeixinAuth) => Effect.Effect<BridgeState, StateStoreError>;
  readonly bind: (binding: SessionBinding) => Effect.Effect<BridgeState, StateStoreError>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<BridgeState, StateStoreError>;
  readonly markProcessed: (messageId: string) => Effect.Effect<BridgeState, StateStoreError>;
  readonly saveCursor: (cursor: string) => Effect.Effect<BridgeState, StateStoreError>;
  readonly logout: Effect.Effect<BridgeState, StateStoreError>;
}

const stateError = (operation: StateStoreError["operation"], path: string) => (cause: unknown) =>
  new StateStoreError({ operation, path, cause });

export const makeStateStore = (
  statePath: string,
  processedLimit = 512,
): Effect.Effect<StateStore, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const lock = yield* Semaphore.make(1);
    const directory = path.dirname(statePath);

    const read: StateStore["read"] = Effect.gen(function* () {
      const exists = yield* fs
        .exists(statePath)
        .pipe(Effect.mapError(stateError("read", statePath)));
      if (!exists) return EMPTY_STATE;
      const encoded = yield* fs
        .readFileString(statePath)
        .pipe(Effect.mapError(stateError("read", statePath)));
      return yield* Schema.decodeUnknownEffect(BridgeStateJsonSchema)(encoded).pipe(
        Effect.mapError(stateError("decode", statePath)),
      );
    }).pipe(Effect.withSpan("pi_weixin.state.read"));

    const writeUnlocked = (state: BridgeState): Effect.Effect<void, StateStoreError> =>
      Effect.gen(function* () {
        const encoded = yield* Schema.encodeUnknownEffect(BridgeStateJsonSchema)(state).pipe(
          Effect.mapError(stateError("encode", statePath)),
        );
        yield* fs
          .makeDirectory(directory, { recursive: true, mode: 0o700 })
          .pipe(Effect.mapError(stateError("write", statePath)));
        yield* fs.chmod(directory, 0o700).pipe(Effect.mapError(stateError("write", statePath)));
        const timestamp = yield* Clock.currentTimeMillis;
        const nonce = yield* Random.nextInt;
        const temporary = path.join(directory, `.state-${timestamp}-${nonce}.tmp`);
        const replace = Effect.gen(function* () {
          yield* fs.writeFileString(temporary, `${encoded}\n`, { flag: "wx", mode: 0o600 });
          yield* fs.chmod(temporary, 0o600);
          yield* fs.rename(temporary, statePath);
          yield* fs.chmod(statePath, 0o600);
        }).pipe(Effect.mapError(stateError("write", statePath)));
        yield* replace.pipe(
          Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
        );
      });

    const write = (state: BridgeState) =>
      lock.withPermits(1)(writeUnlocked(state)).pipe(Effect.withSpan("pi_weixin.state.write"));
    const update = (change: (state: BridgeState) => BridgeState) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          const next = change(yield* read);
          yield* writeUnlocked(next);
          return next;
        }),
      );

    return {
      path: statePath,
      read,
      write,
      saveAuth: (auth) =>
        update((state) => ({
          ...state,
          auth,
          cursor: "",
          processedMessageIds: [],
        })),
      bind: (binding) => update((state) => ({ ...state, binding, enabled: true })),
      setEnabled: (enabled) => update((state) => ({ ...state, enabled })),
      markProcessed: (messageId) =>
        update((state) =>
          state.processedMessageIds.includes(messageId)
            ? state
            : {
                ...state,
                processedMessageIds: [...state.processedMessageIds, messageId].slice(
                  -processedLimit,
                ),
              },
        ),
      saveCursor: (cursor) => update((state) => ({ ...state, cursor })),
      logout: write(EMPTY_STATE).pipe(Effect.as(EMPTY_STATE)),
    };
  });
