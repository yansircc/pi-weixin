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
  expect(projectSessionStatus(status, "session-a")).toEqual({
    kind: "pi-weixin/status",
    version: 1,
    connected: true,
  });
  expect(projectSessionStatus(status, "session-b")).toEqual({
    kind: "pi-weixin/status",
    version: 1,
    connected: false,
  });
});

it("moves the connection projection when the binding changes", () => {
  const before = running("session-a");
  const after = running("session-b");

  expect(projectSessionStatus(before, "session-a").connected).toBe(true);
  expect(projectSessionStatus(before, "session-b").connected).toBe(false);
  expect(projectSessionStatus(after, "session-a").connected).toBe(false);
  expect(projectSessionStatus(after, "session-b").connected).toBe(true);
});

it("projects disconnected when the bridge stops or status cannot be read", () => {
  expect(
    projectSessionStatus(
      {
        ...running("session-a"),
        running: false,
      },
      "session-a",
    ).connected,
  ).toBe(false);
  expect(projectSessionStatus(undefined, "session-a").connected).toBe(false);
});
