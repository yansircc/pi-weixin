import { Schema } from "effect";

const WeixinAuthSchema = Schema.Struct({
  token: Schema.String,
  baseUrl: Schema.String,
  accountId: Schema.String,
  userId: Schema.String,
  savedAt: Schema.String,
});
export type WeixinAuth = Schema.Schema.Type<typeof WeixinAuthSchema>;

const SessionBindingSchema = Schema.Struct({
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  cwd: Schema.String,
});
export type SessionBinding = Schema.Schema.Type<typeof SessionBindingSchema>;

const BridgeStateSchema = Schema.Struct({
  version: Schema.Literal(2),
  enabled: Schema.Boolean,
  cursor: Schema.String,
  processedMessageIds: Schema.Array(Schema.String),
  auth: Schema.optional(WeixinAuthSchema),
  binding: Schema.optional(SessionBindingSchema),
});
export type BridgeState = Schema.Schema.Type<typeof BridgeStateSchema>;
export const BridgeStateJsonSchema = Schema.fromJsonString(BridgeStateSchema);

export const PiPromptProgressEventSchema = Schema.Union([
  Schema.TaggedStruct("ToolStarted", {
    runId: Schema.String,
    toolCallId: Schema.String,
    toolName: Schema.String,
  }),
  Schema.TaggedStruct("Completed", {
    runId: Schema.String,
    text: Schema.String,
  }),
]);
export type PiPromptProgressEvent = Schema.Schema.Type<typeof PiPromptProgressEventSchema>;
export type PiToolProgress = Extract<PiPromptProgressEvent, { readonly _tag: "ToolStarted" }>;
