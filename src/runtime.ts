import { layer as NodeServicesLayer } from "@effect/platform-node/NodeServices";
import { layerUndici as NodeHttpClientLayer } from "@effect/platform-node/NodeHttpClient";
import { Layer, ManagedRuntime } from "effect";
import { Bridge, BridgeLive } from "./bridge.ts";

const PlatformLive = Layer.merge(NodeServicesLayer, NodeHttpClientLayer);

const AppLive = BridgeLive.pipe(Layer.provide(PlatformLive));

export type PiWeixinRuntime = ManagedRuntime.ManagedRuntime<Bridge, unknown>;

declare global {
  var __piWeixinRuntime: PiWeixinRuntime | undefined;
}

export const getPiWeixinRuntime = (): PiWeixinRuntime => {
  if (!globalThis.__piWeixinRuntime) {
    globalThis.__piWeixinRuntime = ManagedRuntime.make(AppLive) as PiWeixinRuntime;
  }
  return globalThis.__piWeixinRuntime;
};
