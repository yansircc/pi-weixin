import extension from "../dist/weixin.mjs";

const commands = new Map();
const events = new Map();

extension({
  registerCommand(name, definition) {
    commands.set(name, definition);
  },
  on(name, handler) {
    events.set(name, handler);
  },
});

const expectedEvents = ["session_start", "session_shutdown"];
if (!commands.has("weixin") || expectedEvents.some((name) => !events.has(name))) {
  process.exitCode = 1;
  console.error("pi-weixin extension registration is incomplete");
}
