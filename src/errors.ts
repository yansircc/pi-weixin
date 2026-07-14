import { Data } from "effect";

export class StateStoreError extends Data.TaggedError("StateStoreError")<{
  readonly operation: "read" | "write" | "decode" | "encode";
  readonly path: string;
  readonly cause: unknown;
}> {}

export class HttpRequestError extends Data.TaggedError("HttpRequestError")<{
  readonly operation: string;
  readonly url: string;
  readonly cause: unknown;
}> {}

export class IlinkProtocolError extends Data.TaggedError("IlinkProtocolError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

export class GatewayError extends Data.TaggedError("GatewayError")<{
  readonly sessionId: string;
  readonly cause: unknown;
}> {}

export class BridgeConfigurationError extends Data.TaggedError("BridgeConfigurationError")<{
  readonly reason: string;
}> {}

export class QrCodeError extends Data.TaggedError("QrCodeError")<{
  readonly cause: unknown;
}> {}
