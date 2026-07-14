import {
  Config,
  Context,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Path,
  PubSub,
  Ref,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import { HttpClient } from "effect/unstable/http";
import {
  BridgeConfigurationError,
  GatewayError,
  HttpRequestError,
  IlinkProtocolError,
  QrCodeError,
  StateStoreError,
} from "./errors.ts";
import { makePiGateway, type PiGateway } from "./gateway.ts";
import { makeJsonHttpClient } from "./http.ts";
import { makeIlinkClient, type LoginCallbacks, type WeixinTransport } from "./ilink.ts";
import { extractText, messageIdentity, replyClientId } from "./message.ts";
import {
  IlinkMessageSchema,
  type SessionBinding,
  type UpdatesResponse,
  type WeixinAuth,
} from "./schema.ts";
import { makeStateStore, type StateStore } from "./state.ts";

const TEXT_ONLY_REPLY = "当前 pi-weixin MVP 仅支持文本消息。";

export interface BridgeStatus {
  readonly running: boolean;
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly accountId?: string;
  readonly sessionId?: string;
  readonly lastError?: string;
}

export interface BatchDependencies {
  readonly store: StateStore;
  readonly transport: WeixinTransport;
  readonly gateway: PiGateway;
}

type BatchError = StateStoreError | HttpRequestError | IlinkProtocolError | GatewayError;

export const processUpdateBatch = (
  response: UpdatesResponse,
  dependencies: BatchDependencies,
): Effect.Effect<void, BatchError> =>
  Effect.gen(function* () {
    const { store, transport, gateway } = dependencies;
    const initial = yield* store.read;
    if (!initial.auth || !initial.binding) {
      return yield* new IlinkProtocolError({
        operation: "bridge.process_batch",
        cause: "微信账号或 Pi session 尚未绑定",
      });
    }
    const auth = initial.auth;
    const binding = initial.binding;

    yield* Effect.forEach(
      response.msgs ?? [],
      (rawMessage) =>
        Effect.gen(function* () {
          const id = messageIdentity(rawMessage);
          const current = yield* store.read;
          if (current.processedMessageIds.includes(id)) return;

          const decoded = yield* Schema.decodeUnknownEffect(IlinkMessageSchema)(rawMessage).pipe(
            Effect.option,
          );
          if (Option.isNone(decoded)) {
            yield* store.markProcessed(id);
            return;
          }
          const message = decoded.value;
          if (message.message_type !== 1 || message.from_user_id !== auth.userId) {
            yield* store.markProcessed(id);
            return;
          }

          const text = extractText(message);
          const reply = text
            ? yield* gateway.promptAndWait(binding.sessionId, text)
            : TEXT_ONLY_REPLY;
          yield* transport.sendText(
            auth,
            message.from_user_id,
            reply,
            message.context_token ?? "",
            replyClientId(id),
          );
          yield* store.markProcessed(id);
        }),
      { concurrency: 1, discard: true },
    );

    if (response.get_updates_buf !== undefined) yield* store.saveCursor(response.get_updates_buf);
  }).pipe(Effect.withSpan("pi_weixin.batch.process"));

type LoginError =
  | QrCodeError
  | BridgeConfigurationError
  | StateStoreError
  | HttpRequestError
  | IlinkProtocolError;
type BridgeLoopError = BatchError;

export interface BridgeService {
  readonly status: Effect.Effect<BridgeStatus, StateStoreError>;
  readonly statusChanges: Stream.Stream<Exit.Exit<BridgeStatus, StateStoreError>>;
  readonly start: Effect.Effect<boolean, StateStoreError>;
  readonly stop: Effect.Effect<void>;
  readonly cancelLogin: Effect.Effect<void>;
  readonly loginAndBind: (
    callbacks: LoginCallbacks<QrCodeError | BridgeConfigurationError>,
    binding: SessionBinding,
  ) => Effect.Effect<WeixinAuth, LoginError>;
  readonly bind: (binding: SessionBinding) => Effect.Effect<void, StateStoreError>;
  readonly setEnabled: (enabled: boolean) => Effect.Effect<void, StateStoreError>;
  readonly logout: Effect.Effect<void, StateStoreError>;
}

export class Bridge extends Context.Service<Bridge, BridgeService>()("@agegr/pi-weixin/Bridge") {}

const describeError = (error: BridgeLoopError): string => error._tag;

export const BridgeLive = Layer.effect(
  Bridge,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const httpClient = yield* HttpClient.HttpClient;
    const home = yield* Config.string("HOME").pipe(
      Effect.mapError(() => new BridgeConfigurationError({ reason: "HOME is not configured" })),
    );
    const statePath = yield* Config.string("PI_WEIXIN_STATE_PATH").pipe(
      Config.withDefault(path.join(home, ".pi", "agent", "pi-weixin", "state.json")),
    );
    const piWebBaseUrl = yield* Config.string("PI_WEB_BASE_URL").pipe(
      Config.withDefault("http://127.0.0.1:30141"),
    );
    const store = yield* makeStateStore(statePath);
    const transport = makeIlinkClient(makeJsonHttpClient(httpClient));
    const gateway = yield* makePiGateway(makeJsonHttpClient(httpClient), piWebBaseUrl);
    const bridgeFiber = yield* Ref.make(Option.none<Fiber.Fiber<void, never>>());
    const loginFiber = yield* Ref.make(Option.none<Fiber.Fiber<WeixinAuth, LoginError>>());
    const lastError = yield* Ref.make(Option.none<string>());
    const lifecycle = yield* Semaphore.make(1);
    const statusInvalidations = yield* PubSub.unbounded<void>({ replay: 1 });

    const status: BridgeService["status"] = Effect.gen(function* () {
      const state = yield* store.read;
      const running = Option.isSome(yield* Ref.get(bridgeFiber));
      const error = yield* Ref.get(lastError);
      return {
        running,
        enabled: state.enabled,
        authenticated: state.auth !== undefined,
        ...(state.auth ? { accountId: state.auth.accountId } : {}),
        ...(state.binding ? { sessionId: state.binding.sessionId } : {}),
        ...(Option.isSome(error) ? { lastError: error.value } : {}),
      };
    });
    const invalidateStatus = PubSub.publish(statusInvalidations, undefined).pipe(Effect.asVoid);
    const statusChanges = Stream.fromPubSub(statusInvalidations).pipe(
      Stream.mapEffect(() => Effect.exit(status)),
    );
    yield* invalidateStatus;

    const iteration = Effect.gen(function* () {
      const state = yield* store.read;
      if (!state.enabled || !state.auth || !state.binding) {
        return yield* new IlinkProtocolError({
          operation: "bridge.loop",
          cause: "bridge is not configured",
        });
      }
      const response = yield* transport.getUpdates(state.auth, state.cursor);
      yield* processUpdateBatch(response, { store, transport, gateway });
      yield* Ref.set(lastError, Option.none());
      yield* invalidateStatus;
    });

    const loop = iteration.pipe(
      Effect.catch((error) =>
        Ref.set(lastError, Option.some(describeError(error))).pipe(
          Effect.andThen(invalidateStatus),
          Effect.andThen(Effect.sleep("3 seconds")),
        ),
      ),
      Effect.forever,
    );

    const stopFiber = <A, E>(ref: Ref.Ref<Option.Option<Fiber.Fiber<A, E>>>) =>
      Ref.getAndSet(ref, Option.none()).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
          }),
        ),
      );

    const startRaw = lifecycle.withPermits(1)(
      Effect.gen(function* () {
        if (Option.isSome(yield* Ref.get(bridgeFiber))) return false;
        const state = yield* store.read;
        if (!state.enabled || !state.auth || !state.binding) return false;
        const fiber = yield* Effect.forkDetach(loop);
        yield* Ref.set(bridgeFiber, Option.some(fiber));
        return true;
      }),
    );

    const stopBridge = lifecycle.withPermits(1)(stopFiber(bridgeFiber));
    const cancelLogin = stopFiber(loginFiber);
    const stopRaw = Effect.all([cancelLogin, stopBridge], { discard: true });
    const observeStatus = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.ensuring(invalidateStatus));

    const service: BridgeService = {
      status,
      statusChanges,
      start: observeStatus(startRaw),
      stop: observeStatus(stopRaw),
      cancelLogin,
      loginAndBind: (callbacks, binding) =>
        observeStatus(
          Effect.gen(function* () {
            yield* cancelLogin;
            const login = Effect.gen(function* () {
              const auth = yield* transport.login(callbacks);
              yield* store.saveAuth(auth);
              yield* store.bind(binding);
              yield* startRaw;
              return auth;
            });
            const fiber = yield* Effect.forkDetach(login);
            yield* Ref.set(loginFiber, Option.some(fiber));
            return yield* Fiber.join(fiber).pipe(
              Effect.ensuring(
                Ref.update(loginFiber, (current) =>
                  Option.isSome(current) && current.value === fiber ? Option.none() : current,
                ),
              ),
            );
          }),
        ),
      bind: (binding) =>
        observeStatus(store.bind(binding).pipe(Effect.andThen(startRaw), Effect.asVoid)),
      setEnabled: (enabled) =>
        observeStatus(
          enabled
            ? store.setEnabled(true).pipe(Effect.andThen(startRaw), Effect.asVoid)
            : stopRaw.pipe(Effect.andThen(store.setEnabled(false)), Effect.asVoid),
        ),
      logout: observeStatus(stopRaw.pipe(Effect.andThen(store.logout), Effect.asVoid)),
    };
    return service;
  }),
);
