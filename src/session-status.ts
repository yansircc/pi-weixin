import type { BridgeStatus } from "./bridge.ts";

export type WeixinStatusProjection = Readonly<{
  kind: "pi-weixin/status";
  version: 2;
  bindings: ReadonlyArray<
    Readonly<{
      sessionId: string;
      accountId?: string;
      connected: boolean;
    }>
  >;
}>;

export interface WeixinStatusUi {
  setStatus(key: string, text: string | undefined): void;
  setStructuredStatus?(key: string, status: WeixinStatusProjection | undefined): void;
}

export const projectSessionStatus = (status: BridgeStatus | undefined): WeixinStatusProjection => ({
  kind: "pi-weixin/status",
  version: 2,
  bindings: status?.sessionId
    ? [
        {
          sessionId: status.sessionId,
          ...(status.accountId ? { accountId: status.accountId } : {}),
          connected: status.running,
        },
      ]
    : [],
});

export const sameSessionStatus = (
  left: WeixinStatusProjection,
  right: WeixinStatusProjection,
): boolean => {
  if (left.bindings.length !== right.bindings.length) return false;
  const rightBySession = new Map(right.bindings.map((binding) => [binding.sessionId, binding]));
  return left.bindings.every((binding) => {
    const candidate = rightBySession.get(binding.sessionId);
    return (
      candidate !== undefined &&
      binding.accountId === candidate.accountId &&
      binding.connected === candidate.connected
    );
  });
};

export const publishSessionStatus = (
  ui: WeixinStatusUi,
  status: WeixinStatusProjection,
  currentSessionId: string,
): void => {
  if (typeof ui.setStructuredStatus === "function") {
    ui.setStructuredStatus("weixin", status);
    return;
  }
  // Pi's public Extension UI contract currently exposes only setStatus. Keep this
  // terminal-host projection until structured statuses are standardized by Pi
  // and every supported host implements that contract.
  const binding = status.bindings.find((candidate) => candidate.sessionId === currentSessionId);
  ui.setStatus("weixin", binding ? (binding.connected ? "微信已连接" : "微信未连接") : undefined);
};
