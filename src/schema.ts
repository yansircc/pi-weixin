import { Schema } from "effect";

export const WeixinAuthSchema = Schema.Struct({
  token: Schema.String,
  baseUrl: Schema.String,
  accountId: Schema.String,
  userId: Schema.String,
  savedAt: Schema.String,
});
export type WeixinAuth = Schema.Schema.Type<typeof WeixinAuthSchema>;

export const SessionBindingSchema = Schema.Struct({
  sessionId: Schema.String,
  sessionFile: Schema.optional(Schema.String),
  cwd: Schema.String,
});
export type SessionBinding = Schema.Schema.Type<typeof SessionBindingSchema>;

export const BridgeStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  enabled: Schema.Boolean,
  cursor: Schema.String,
  processedMessageIds: Schema.Array(Schema.String),
  auth: Schema.optional(WeixinAuthSchema),
  binding: Schema.optional(SessionBindingSchema),
});
export type BridgeState = Schema.Schema.Type<typeof BridgeStateSchema>;
export const BridgeStateJsonSchema = Schema.fromJsonString(BridgeStateSchema);

export const IlinkItemSchema = Schema.Struct({
  type: Schema.optional(Schema.Number),
  text_item: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.String) })),
});

export const IlinkMessageSchema = Schema.Struct({
  message_type: Schema.optional(Schema.Number),
  from_user_id: Schema.optional(Schema.String),
  context_token: Schema.optional(Schema.String),
  item_list: Schema.optional(Schema.Array(IlinkItemSchema)),
});
export type IlinkMessage = Schema.Schema.Type<typeof IlinkMessageSchema>;

export const UpdatesResponseSchema = Schema.Struct({
  ret: Schema.optional(Schema.Number),
  msgs: Schema.optional(Schema.Array(Schema.Unknown)),
  get_updates_buf: Schema.optional(Schema.String),
});
export type UpdatesResponse = Schema.Schema.Type<typeof UpdatesResponseSchema>;

export const LoginQrResponseSchema = Schema.Struct({
  ret: Schema.optional(Schema.Number),
  qrcode: Schema.String,
  qrcode_img_content: Schema.String,
});

export const LoginStatusResponseSchema = Schema.Struct({
  ret: Schema.optional(Schema.Number),
  status: Schema.String,
  bot_token: Schema.optional(Schema.String),
  baseurl: Schema.optional(Schema.String),
  ilink_bot_id: Schema.optional(Schema.String),
  ilink_user_id: Schema.optional(Schema.String),
});

export const PiGatewayResponseSchema = Schema.Struct({
  success: Schema.optional(Schema.Boolean),
  data: Schema.optional(Schema.Struct({ text: Schema.optional(Schema.Unknown) })),
  error: Schema.optional(Schema.Unknown),
});
