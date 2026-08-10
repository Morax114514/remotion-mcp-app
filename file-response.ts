import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { Readable } from "node:stream";

export type ServeFileOptions = {
  contentType: string;
  size?: number;
  etag?: string;
  cacheControl?: string;
  disposition?: string;
  rangeHeader?: string;
};

function baseHeaders(options: ServeFileOptions): Headers {
  const headers = new Headers({
    "Content-Type": options.contentType,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": options.cacheControl ?? "private, max-age=3600",
  });
  if (options.etag) headers.set("ETag", options.etag);
  if (options.disposition) headers.set("Content-Disposition", options.disposition);
  return headers;
}

function parseRange(value: string, total: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || total <= 0) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, total - suffix), end: total - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= total || requestedEnd < start) {
    return null;
  }
  return { start, end: Math.min(total - 1, requestedEnd) };
}

export async function serveFile(filePath: string, options: ServeFileOptions): Promise<Response> {
  const total = options.size ?? (await fs.stat(filePath)).size;
  const headers = baseHeaders(options);
  const rangeValue = options.rangeHeader?.trim();

  if (rangeValue) {
    const range = parseRange(rangeValue, total);
    if (!range) {
      headers.set("Content-Range", `bytes */${total}`);
      return new Response(null, { status: 416, headers });
    }
    const length = range.end - range.start + 1;
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${total}`);
    headers.set("Content-Length", String(length));
    const stream = createReadStream(filePath, { start: range.start, end: range.end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
  }

  headers.set("Content-Length", String(total));
  const stream = createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, { status: 200, headers });
}
