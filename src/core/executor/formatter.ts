import pc from "picocolors";
import type { ExecutedRequest } from "./httpClient.ts";

function statusColor(status: number, text: string): string {
  if (status >= 500) return pc.red(text);
  if (status >= 400) return pc.yellow(text);
  if (status >= 200 && status < 300) return pc.green(text);
  return pc.dim(text);
}

export function formatResult(result: ExecutedRequest): string {
  const mark = result.ok ? pc.green("✓") : pc.red("✗");
  const id = result.id.padEnd(16);
  const method = result.method.padEnd(6);
  const status = statusColor(result.status, String(result.status));
  const duration = `${Math.round(result.durationMs)}ms`;
  return `${mark} ${id} ${method} ${result.path}  ${status}  ${pc.dim(duration)}`;
}

export function formatError(id: string, message: string): string {
  return `${pc.red("✗")} ${id.padEnd(16)} ${pc.red(message)}`;
}
