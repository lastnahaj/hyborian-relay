const unrealTimestampPattern =
  /^\[(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})(?::(\d{3}))?\]/u;

export function parseUnrealLogTimestamp(line: string): Date | undefined {
  const match = unrealTimestampPattern.exec(line);
  if (match === null) return undefined;
  const [, year, month, day, hour, minute, second, milliseconds = "0"] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return undefined;
  }
  const timestamp = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(milliseconds),
    ),
  );
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
}
