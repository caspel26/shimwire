import type { ExecutedRequest } from "./httpClient.ts";

export interface ReportEntry {
  id: string;
  method: string;
  path: string;
  ok: boolean;
  status?: number;
  durationMs?: number;
  requestHeaders?: Record<string, string>;
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
}

const SENSITIVE_HEADER_RE = /^(authorization|cookie|set-cookie|x-api-key)$/i;

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADER_RE.test(key) ? "«redacted»" : value;
  }
  return out;
}

export function toReportEntry(result: ExecutedRequest): ReportEntry {
  return {
    id: result.id,
    method: result.method,
    path: result.path,
    ok: result.ok,
    status: result.status,
    durationMs: result.durationMs,
    requestHeaders: redactHeaders(result.requestHeaders),
    requestBody: result.requestBody,
    responseBody: result.response,
  };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonBlock(value: unknown): string {
  if (value === undefined) return "<em>(none)</em>";
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderEntry(entry: ReportEntry): string {
  const statusLabel = entry.status ?? (entry.error ? "ERR" : "-");
  const duration = entry.durationMs !== undefined ? `${Math.round(entry.durationMs)}ms` : "-";

  return `
    <details class="entry ${entry.ok ? "pass" : "fail"}">
      <summary>
        <span class="mark">${entry.ok ? "✓" : "✗"}</span>
        <span class="id">${escapeHtml(entry.id)}</span>
        <span class="method">${escapeHtml(entry.method)}</span>
        <span class="path">${escapeHtml(entry.path)}</span>
        <span class="status">${escapeHtml(String(statusLabel))}</span>
        <span class="duration">${duration}</span>
      </summary>
      <div class="body">
        ${entry.error ? `<h4>Error</h4><pre class="error">${escapeHtml(entry.error)}</pre>` : ""}
        <h4>Request headers</h4>
        ${jsonBlock(entry.requestHeaders)}
        <h4>Request body</h4>
        ${jsonBlock(entry.requestBody)}
        <h4>Response body</h4>
        ${jsonBlock(entry.responseBody)}
      </div>
    </details>`;
}

export function renderHtmlReport(
  entries: ReportEntry[],
  meta: { collection: string; env: string }
): string {
  const passed = entries.filter((e) => e.ok).length;
  const failed = entries.length - passed;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>shimwire report — ${escapeHtml(meta.collection)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, monospace; margin: 2rem; max-width: 900px; }
  h1 { font-size: 1.1rem; }
  .summary { margin-bottom: 1.5rem; }
  .summary .pass { color: #2e7d32; }
  .summary .fail { color: #c62828; }
  details.entry { border: 1px solid #8884; border-radius: 6px; margin-bottom: 0.5rem; padding: 0.25rem 0.75rem; }
  details.entry summary { cursor: pointer; display: flex; gap: 0.75rem; align-items: center; list-style: none; }
  details.entry summary::-webkit-details-marker { display: none; }
  .entry.pass > summary .mark { color: #2e7d32; }
  .entry.fail > summary .mark { color: #c62828; }
  .id { font-weight: bold; flex: 1; }
  .method { opacity: 0.7; width: 4.5rem; }
  .path { opacity: 0.7; flex: 2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { width: 3rem; text-align: right; }
  .duration { width: 4rem; text-align: right; opacity: 0.6; }
  .body { padding: 0.5rem 0 0.75rem; }
  .body h4 { margin: 0.75rem 0 0.25rem; opacity: 0.7; font-size: 0.85rem; }
  pre { background: #8881; padding: 0.5rem; border-radius: 4px; overflow-x: auto; margin: 0; }
  pre.error { color: #c62828; }
</style>
</head>
<body>
  <h1>shimwire run — ${escapeHtml(meta.collection)} (env: ${escapeHtml(meta.env)})</h1>
  <p class="summary"><span class="pass">${passed} passed</span> · <span class="fail">${failed} failed</span> · ${entries.length} total</p>
  ${entries.map(renderEntry).join("\n")}
</body>
</html>
`;
}
