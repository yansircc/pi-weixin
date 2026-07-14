import type { BridgeStatus } from "./bridge.ts";

export type WeixinStatusProjection = Readonly<{
  kind: "pi-weixin/status";
  version: 1;
  connected: boolean;
}>;

export interface WeixinStatusUi {
  setStatus(key: string, text: string | undefined): void;
  setStructuredStatus?(key: string, status: WeixinStatusProjection | undefined): void;
}

export const projectSessionStatus = (
  status: BridgeStatus | undefined,
  sessionId: string,
): WeixinStatusProjection => ({
  kind: "pi-weixin/status",
  version: 1,
  connected: status?.running === true && status.sessionId === sessionId,
});

export const publishSessionStatus = (ui: WeixinStatusUi, status: WeixinStatusProjection): void => {
  if (typeof ui.setStructuredStatus === "function") {
    ui.setStructuredStatus("weixin", status);
    return;
  }
  // Pi's public Extension UI contract currently exposes only setStatus. Keep this
  // terminal-host projection until structured statuses are standardized by Pi
  // and every supported host implements that contract.
  ui.setStatus("weixin", status.connected ? "微信已连接" : undefined);
};
