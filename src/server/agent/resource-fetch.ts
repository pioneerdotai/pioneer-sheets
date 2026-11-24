import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { ServiceError } from "../documents/error";

export const MAX_BYTES = 20_000_000;

export function privateAddress(ip: string) {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  return (
    !/^[23][0-9a-f]{3}:/.test(v) ||
    v.startsWith("2001:db8:") ||
    v.startsWith("2002:")
  );
}

export async function fetchPublicResource(
  input: string,
  redirects = 0,
): Promise<{ data: Buffer; mimeType: string; url: string }> {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    redirects > 3
  )
    throw new ServiceError(400, "RESOURCE_URL_NOT_ALLOWED");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(host, { all: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address)))
    throw new ServiceError(400, "PRIVATE_RESOURCE_ADDRESS");
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": "Pioneer-Office-Resources/1.0",
          Accept: "*/*",
        },
        lookup: ((_: any, options: any, callback: any) =>
          options?.all
            ? callback(null, [selected])
            : callback(null, selected.address, selected.family)) as any,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
          res.resume();
          if (!res.headers.location) {
            reject(new Error("RESOURCE_REDIRECT_WITHOUT_LOCATION"));
            return;
          }
          fetchPublicResource(
            new URL(res.headers.location, url).href,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error("RESOURCE_HTTP_" + res.statusCode));
          return;
        }
        if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) {
          res.destroy();
          reject(new Error("RESOURCE_TOO_LARGE"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy(new Error("RESOURCE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            data: Buffer.concat(chunks),
            mimeType: String(
              res.headers["content-type"] ?? "application/octet-stream",
            ).split(";")[0],
            url: url.href,
          }),
        );
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(new Error("RESOURCE_FETCH_TIMEOUT")),
    );
    req.on("error", reject);
    req.end();
  });
}
