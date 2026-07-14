import { expect, it } from "@effect/vitest";
import {
  publishSessionStatus,
  type WeixinStatusProjection,
  type WeixinStatusUi,
} from "../src/session-status.ts";

const status = (connected: boolean): WeixinStatusProjection => ({
  kind: "pi-weixin/status",
  version: 1,
  connected,
});

it("publishes structured connection state when the host supports it", () => {
  const structured: Array<WeixinStatusProjection | undefined> = [];
  const text: Array<string | undefined> = [];
  const ui: WeixinStatusUi = {
    setStructuredStatus: (_key, value) => structured.push(value),
    setStatus: (_key, value) => text.push(value),
  };

  publishSessionStatus(ui, status(true));
  publishSessionStatus(ui, status(false));

  expect(structured).toEqual([status(true), status(false)]);
  expect(text).toEqual([]);
});

it("keeps the text status as a compatibility projection for terminal hosts", () => {
  const text: Array<string | undefined> = [];
  const ui: WeixinStatusUi = {
    setStatus: (_key, value) => text.push(value),
  };

  publishSessionStatus(ui, status(true));
  publishSessionStatus(ui, status(false));

  expect(text).toEqual(["微信已连接", undefined]);
});
