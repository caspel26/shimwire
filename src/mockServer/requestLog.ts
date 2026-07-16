import pc from "picocolors";
import type { MockRequestLogEntry } from "./routerBuilder.ts";

function statusColor(status: number, text: string): string {
  if (status >= 500) return pc.red(text);
  if (status >= 400) return pc.yellow(text);
  if (status >= 200 && status < 300) return pc.green(text);
  return pc.dim(text);
}

export function formatMockRequestLog(entry: MockRequestLogEntry): string {
  const time = new Date().toLocaleTimeString();
  const method = entry.method.padEnd(6);
  const status = statusColor(entry.status, String(entry.status));
  const duration = `${Math.round(entry.durationMs)}ms`;
  return `${pc.dim(time)}  ${method} ${entry.path}  ${status}  ${pc.dim(duration)}`;
}
