import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import QRCode from "qrcode";
import { Bridge, type BridgeStatus } from "../src/bridge.ts";
import { BridgeConfigurationError, QrCodeError } from "../src/errors.ts";
import { getPiWeixinRuntime } from "../src/runtime.ts";

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

const syncStatus = (ctx: ExtensionContext) =>
  Effect.gen(function* () {
    const bridge = yield* Bridge;
    const status = yield* bridge.status;
    yield* Effect.sync(() => {
      ctx.ui.setStatus("weixin", status.running ? "微信已连接" : undefined);
    });
    return status;
  });

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
    yield* syncStatus(ctx);
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
        yield* syncStatus(ctx);
        return yield* Effect.sync(() => ctx.ui.notify("微信已绑定当前 Pi session", "info"));
      case "start":
        yield* bridge.setEnabled(true);
        return yield* syncStatus(ctx).pipe(
          Effect.tap((status) => Effect.sync(() => ctx.ui.notify(formatStatus(status), "info"))),
          Effect.asVoid,
        );
      case "stop":
        yield* bridge.setEnabled(false);
        return yield* syncStatus(ctx).pipe(
          Effect.tap((status) => Effect.sync(() => ctx.ui.notify(formatStatus(status), "info"))),
          Effect.asVoid,
        );
      case "logout":
        yield* bridge.logout;
        yield* syncStatus(ctx);
        return yield* Effect.sync(() => ctx.ui.notify("微信登录和 session 绑定已清除", "info"));
      case "status":
        return yield* syncStatus(ctx).pipe(
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

  pi.registerCommand("weixin", {
    description: "连接微信 iLink 与当前 Pi session",
    handler: (args, ctx) => runtime.runPromise(handleCommandEffect(args, ctx)),
  });

  pi.on("session_start", (_event, ctx) =>
    runtime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Bridge;
        yield* bridge.start;
        yield* syncStatus(ctx);
      }),
    ),
  );

  pi.on("session_shutdown", () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const bridge = yield* Bridge;
        yield* bridge.cancelLogin;
      }),
    ),
  );
}
