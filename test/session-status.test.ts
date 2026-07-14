import { expect, it } from "@effect/vitest";
import type { BridgeStatus } from "../src/bridge.ts";
import { projectSessionStatus } from "../src/session-status.ts";

const running = (sessionId: string): BridgeStatus => ({
  running: true,
  enabled: true,
  authenticated: true,
  sessionId,
});

it("shows the connection only on the bound session", () => {
  const status = running("session-a");
  expect(projectSessionStatus(status, "session-a")).toBe("微信已连接");
  expect(projectSessionStatus(status, "session-b")).toBeUndefined();
});

it("moves the connection projection when the binding changes", () => {
  const before = running("session-a");
  const after = running("session-b");

  expect(projectSessionStatus(before, "session-a")).toBe("微信已连接");
  expect(projectSessionStatus(before, "session-b")).toBeUndefined();
  expect(projectSessionStatus(after, "session-a")).toBeUndefined();
  expect(projectSessionStatus(after, "session-b")).toBe("微信已连接");
});

it("clears the projection when the bridge stops", () => {
  expect(
    projectSessionStatus(
      {
        ...running("session-a"),
        running: false,
      },
      "session-a",
    ),
  ).toBeUndefined();
});
