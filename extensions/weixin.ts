import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Effect, Exit, Fiber, Option, Ref, Semaphore, Stream } from "effect";
import QRCode from "qrcode";
import { Bridge, type BridgeStatus } from "../src/bridge.ts";
import { BridgeConfigurationError, QrCodeError } from "../src/errors.ts";
import { getPiWeixinRuntime } from "../src/runtime.ts";
import { publishSessionStatus, projectSessionStatus } from "../src/session-status.ts";

interface ImageWidgetUi {
  setImageWidget?: (
    key: string,
    image:
      | {
          dataUrl: string;
          alt: string;
          width: number;
          height: number;
        }
      | undefined,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ) => void;
}

const bindingFrom = (ctx: ExtensionContext) => ({
  sessionId: ctx.sessionManager.getSessionId(),
  sessionFile: ctx.sessionManager.getSessionFile(),
  cwd: ctx.cwd,
});

const formatStatus = (status: BridgeStatus): string => {
  const state = status.running ? "运行中" : status.enabled ? "等待启动" : "已停止";
  const account = status.accountId ? `，微信 ${status.accountId}` : "，未登录";
  const session = status.sessionId ? `，session ${status.sessionId}` : "，未绑定 session";
  const error = status.lastError ? `，错误：${status.lastError}` : "";
  return `${state}${account}${session}${error}`;
};

const clearLoginWidget = (ctx: ExtensionCommandContext, imageUi: ImageWidgetUi) =>
  Effect.sync(() => {
    ctx.ui.setWidget("weixin-login", undefined);
    imageUi.setImageWidget?.("weixin-login", undefined);
  });

const login = (ctx: ExtensionCommandContext) =>
  Effect.gen(function* () {
    if (!ctx.hasUI) {
      return yield* new BridgeConfigurationError({ reason: "微信登录需要可交互 UI" });
    }
    const bridge = yield* Bridge;
    const imageUi = ctx.ui as typeof ctx.ui & ImageWidgetUi;
    const callbacks = {
      onQr: (content: string) =>
        ctx.mode === "tui"
          ? Effect.tryPromise({
              try: () => QRCode.toString(content, { type: "utf8" }),
              catch: (cause) => new QrCodeError({ cause }),
            }).pipe(
              Effect.tap((qr) =>
                Effect.sync(() => {
                  ctx.ui.setWidget(
                    "weixin-login",
                    ["请用微信扫描：", ...qr.trimEnd().split("\n")],
                    {
                      placement: "aboveEditor",
                    },
                  );
                }),
              ),
              Effect.asVoid,
            )
          : Effect.gen(function* () {
              if (!imageUi.setImageWidget) {
                return yield* new BridgeConfigurationError({
                  reason: "当前宿主不支持图片 Widget，请更新 pi-web",
                });
              }
              const dataUrl = yield* Effect.tryPromise({
                try: () =>
                  QRCode.toDataURL(content, {
                    errorCorrectionLevel: "M",
                    margin: 4,
                    width: 384,
                  }),
                catch: (cause) => new QrCodeError({ cause }),
              });
              yield* Effect.sync(() => {
                imageUi.setImageWidget?.(
                  "weixin-login",
                  {
                    dataUrl,
                    alt: "微信登录二维码",
                    width: 384,
                    height: 384,
                  },
                  { placement: "aboveEditor" },
                );
              });
            }),
      onStatus: (message: string) => Effect.sync(() => ctx.ui.notify(message, "info")),
    };
    const auth = yield* bridge
      .loginAndBind(callbacks, bindingFrom(ctx))
      .pipe(Effect.ensuring(clearLoginWidget(ctx, imageUi)));
    yield* Effect.sync(() => {
      ctx.ui.notify(`微信已登录并绑定当前 session：${auth.accountId}`, "info");
    });
  });

const handleCommandEffect = (args: string, ctx: ExtensionCommandContext) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const [command = "status"] = args.trim().split(/\s+/);
    switch (command) {
      case "login":
        return yield* login(ctx);
      case "bind":
        yield* bridge.bind(bindingFrom(ctx));
        return yield* Effect.sync(() => ctx.ui.notify("微信已绑定当前 Pi session", "info"));
      case "start":
        yield* bridge.setEnabled(true);
        return yield* bridge.status.pipe(
          Effect.tap((status) => Effect.sync(() => ctx.ui.notify(formatStatus(status), "info"))),
          Effect.asVoid,
        );
      case "stop":
        yield* bridge.setEnabled(false);
        return yield* bridge.status.pipe(
          Effect.tap((status) => Effect.sync(() => ctx.ui.notify(formatStatus(status), "info"))),
          Effect.asVoid,
        );
      case "logout":
        yield* bridge.logout;
        return yield* Effect.sync(() => ctx.ui.notify("微信登录和 session 绑定已清除", "info"));
      case "status":
        return yield* bridge.status.pipe(
          Effect.tap((status) => Effect.sync(() => ctx.ui.notify(formatStatus(status), "info"))),
          Effect.asVoid,
        );
      default:
        return yield* new BridgeConfigurationError({
          reason: "用法：/weixin login|bind|start|stop|status|logout",
        });
    }
  });

export default function weixinExtension(pi: ExtensionAPI): void {
  const runtime = getPiWeixinRuntime();
  const statusFiber = Ref.makeUnsafe(Option.none<Fiber.Fiber<void, unknown>>());
  const statusLifecycle = Semaphore.makeUnsafe(1);

  const stopStatusSyncRaw = Ref.getAndSet(statusFiber, Option.none()).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.void,
        onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.asVoid),
      }),
    ),
  );
  const stopStatusSync = statusLifecycle.withPermits(1)(stopStatusSyncRaw);

  const startStatusSync = (ctx: ExtensionContext) =>
    statusLifecycle.withPermits(1)(
      Effect.gen(function* () {
        yield* stopStatusSyncRaw;
        const bridge = yield* Bridge;
        const sessionId = ctx.sessionManager.getSessionId();
        const fiber = yield* bridge.statusChanges.pipe(
          Stream.map(
            Exit.match({
              onFailure: () => projectSessionStatus(undefined, sessionId),
              onSuccess: (status) => projectSessionStatus(status, sessionId),
            }),
          ),
          Stream.changesWith((previous, current) => previous.connected === current.connected),
          Stream.runForEach((status) =>
            Effect.sync(() => {
              publishSessionStatus(ctx.ui, status);
            }),
          ),
          Effect.forkDetach,
        );
        yield* Ref.set(statusFiber, Option.some(fiber));
      }),
    );

  pi.registerCommand("weixin", {
    description: "连接微信 iLink 与当前 Pi session",
    handler: (args, ctx) => runtime.runPromise(handleCommandEffect(args, ctx)),
  });

  pi.on("session_start", (_event, ctx) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Bridge;
        yield* startStatusSync(ctx);
        yield* bridge.start;
      }),
    ),
  );

  pi.on("session_shutdown", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Bridge;
        yield* stopStatusSync;
        yield* bridge.cancelLogin;
      }),
    ),
  );
}
