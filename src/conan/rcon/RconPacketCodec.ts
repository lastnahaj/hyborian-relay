import { RelayError } from "../../errors/RelayError.js";

export const MAXIMUM_RCON_PACKET_LENGTH = 1_048_576;

export const RconPacketType = {
  responseValue: 0,
  command: 2,
  authenticationResponse: 2,
  authentication: 3,
} as const;

export interface RconPacket {
  requestIdentifier: number;
  type: number;
  payload: string;
}

function protocolError(message: string): RelayError {
  return new RelayError("RCON_PROTOCOL_ERROR", message);
}

export function encodeRconPacket(packet: RconPacket): Buffer {
  if (
    !Number.isInteger(packet.requestIdentifier) ||
    packet.requestIdentifier < -2_147_483_648 ||
    packet.requestIdentifier > 2_147_483_647
  ) {
    throw protocolError("RCON request identifier must be a signed 32-bit integer.");
  }
  if (!Number.isInteger(packet.type)) throw protocolError("RCON packet type must be an integer.");

  const payload = Buffer.from(packet.payload, "utf8");
  const packetLength = payload.length + 10;
  if (packetLength > MAXIMUM_RCON_PACKET_LENGTH) {
    throw protocolError(`RCON packet length ${packetLength} exceeds the safety limit.`);
  }

  const encodedPacket = Buffer.allocUnsafe(packetLength + 4);
  encodedPacket.writeInt32LE(packetLength, 0);
  encodedPacket.writeInt32LE(packet.requestIdentifier, 4);
  encodedPacket.writeInt32LE(packet.type, 8);
  payload.copy(encodedPacket, 12);
  encodedPacket.writeUInt8(0, encodedPacket.length - 2);
  encodedPacket.writeUInt8(0, encodedPacket.length - 1);
  return encodedPacket;
}

export class RconPacketDecoder {
  #receiveBuffer = Buffer.alloc(0);

  public append(receivedData: Buffer): RconPacket[] {
    if (receivedData.length === 0) return [];
    this.#receiveBuffer = Buffer.concat([this.#receiveBuffer, receivedData]);
    const packets: RconPacket[] = [];

    while (this.#receiveBuffer.length >= 4) {
      const packetLength = this.#receiveBuffer.readInt32LE(0);
      if (packetLength < 10) throw protocolError(`Malformed RCON packet length: ${packetLength}.`);
      if (packetLength > MAXIMUM_RCON_PACKET_LENGTH) {
        throw protocolError(`RCON packet length ${packetLength} exceeds the safety limit.`);
      }
      const encodedLength = packetLength + 4;
      if (this.#receiveBuffer.length < encodedLength) break;

      const encodedPacket = this.#receiveBuffer.subarray(0, encodedLength);
      if (encodedPacket[encodedLength - 2] !== 0 || encodedPacket[encodedLength - 1] !== 0) {
        throw protocolError("Malformed RCON packet terminator.");
      }
      packets.push({
        requestIdentifier: encodedPacket.readInt32LE(4),
        type: encodedPacket.readInt32LE(8),
        payload: encodedPacket.subarray(12, encodedLength - 2).toString("utf8"),
      });
      this.#receiveBuffer = this.#receiveBuffer.subarray(encodedLength);
    }
    return packets;
  }

  public get bufferedByteCount(): number {
    return this.#receiveBuffer.length;
  }
}
