import { describe, expect, it } from "vitest";

import {
  MAXIMUM_RCON_PACKET_LENGTH,
  RconPacketDecoder,
  RconPacketType,
  encodeRconPacket,
} from "../../src/conan/rcon/RconPacketCodec.js";

describe("RCON packet framing", () => {
  it("encodes the little-endian length, signed identifier, type, and terminators", () => {
    const encoded = encodeRconPacket({
      requestIdentifier: -42,
      type: RconPacketType.command,
      payload: "listplayers",
    });

    expect(encoded.readInt32LE(0)).toBe(encoded.length - 4);
    expect(encoded.readInt32LE(4)).toBe(-42);
    expect(encoded.readInt32LE(8)).toBe(RconPacketType.command);
    expect(encoded.subarray(-2)).toEqual(Buffer.from([0, 0]));
  });

  it("buffers fragmented TCP data until a complete packet arrives", () => {
    const encoded = encodeRconPacket({ requestIdentifier: 8, type: 0, payload: "Vaelric" });
    const decoder = new RconPacketDecoder();

    expect(decoder.append(encoded.subarray(0, 5))).toEqual([]);
    expect(decoder.bufferedByteCount).toBe(5);
    expect(decoder.append(encoded.subarray(5))).toEqual([
      { requestIdentifier: 8, type: 0, payload: "Vaelric" },
    ]);
  });

  it("decodes several packets delivered in one TCP read", () => {
    const decoder = new RconPacketDecoder();
    const combined = Buffer.concat([
      encodeRconPacket({ requestIdentifier: 11, type: 0, payload: "Nyssara" }),
      encodeRconPacket({ requestIdentifier: 12, type: 0, payload: "Rhovan" }),
    ]);

    expect(decoder.append(combined).map((packet) => packet.payload)).toEqual(["Nyssara", "Rhovan"]);
  });

  it("rejects malformed, oversized, and unterminated packets", () => {
    const malformed = Buffer.alloc(14);
    malformed.writeInt32LE(9, 0);
    expect(() => new RconPacketDecoder().append(malformed)).toThrow(
      /Malformed RCON packet length/u,
    );

    const oversized = Buffer.alloc(4);
    oversized.writeInt32LE(MAXIMUM_RCON_PACKET_LENGTH + 1, 0);
    expect(() => new RconPacketDecoder().append(oversized)).toThrow(/safety limit/u);

    const unterminated = encodeRconPacket({ requestIdentifier: 3, type: 0, payload: "Selvara" });
    unterminated[unterminated.length - 1] = 1;
    expect(() => new RconPacketDecoder().append(unterminated)).toThrow(/terminator/u);
  });
});
