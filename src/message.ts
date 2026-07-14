import { createHash } from "node:crypto";
import type { IlinkMessage } from "./schema.ts";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function messageIdentity(message: unknown): string {
  return createHash("sha256").update(canonicalJson(message)).digest("hex");
}

export function replyClientId(messageId: string): string {
  return `piw-${messageId.slice(0, 32)}`;
}

export function extractText(message: IlinkMessage): string | undefined {
  const text = (message.item_list ?? [])
    .filter((item) => item.type === 1 && typeof item.text_item?.text === "string")
    .map((item) => item.text_item?.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}
