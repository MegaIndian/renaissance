/** The slice of pino the hub modules use, so tests can pass a recorder. */
export interface Logger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

/** Collects log lines; `--dry-run` prints them, tests assert on them. */
export function recordingLogger(sink?: (line: string) => void): Logger & { lines: string[] } {
  const lines: string[] = [];
  const push = (level: string, obj: Record<string, unknown>, msg: string): void => {
    const line = `${level} ${msg} ${JSON.stringify(obj)}`;
    lines.push(line);
    sink?.(line);
  };
  return {
    lines,
    info: (o, m) => push('info', o, m),
    warn: (o, m) => push('warn', o, m),
    error: (o, m) => push('error', o, m),
  };
}
