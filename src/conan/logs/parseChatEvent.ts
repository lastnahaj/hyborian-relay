import { parseUnrealLogTimestamp } from "./gameEventTimestamp.js";

type GameChatChannel = "global" | "local" | "clan" | "whisper" | "unknown";

export interface GameChatEvent {
  playerName: string;
  message: string;
  channel: GameChatChannel;
  occurredAt: Date;
  source: "pippi-chat-log";
}

const pippiChatPattern = /\[Pippi\]PippiChat:\s*(.+?)\s+said in channel\s+\[(.+?)\]\s*:\s*(.*)$/u;

function classifyChannel(channelName: string): GameChatChannel {
  const normalizedChannel = channelName.trim().toLowerCase();
  if (normalizedChannel === "global") return "global";
  if (normalizedChannel === "local") return "local";
  if (normalizedChannel === "clan") return "clan";
  if (normalizedChannel === "whisper" || normalizedChannel === "private") return "whisper";
  return "unknown";
}

export function parseChatEvent(line: string): GameChatEvent | undefined {
  const match = pippiChatPattern.exec(line);
  if (match === null) return undefined;
  const [, playerName, channelName, message] = match;
  const occurredAt = parseUnrealLogTimestamp(line);
  if (
    playerName === undefined ||
    channelName === undefined ||
    message === undefined ||
    occurredAt === undefined ||
    playerName.trim() === "" ||
    message.trim() === ""
  ) {
    return undefined;
  }
  return {
    playerName: playerName.trim(),
    message: message.trim(),
    channel: classifyChannel(channelName),
    occurredAt,
    source: "pippi-chat-log",
  };
}
