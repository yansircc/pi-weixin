import type { BridgeStatus } from "./bridge.ts";

export const projectSessionStatus = (status: BridgeStatus, sessionId: string): string | undefined =>
  status.running && status.sessionId === sessionId ? "微信已连接" : undefined;
