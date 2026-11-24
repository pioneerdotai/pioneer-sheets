import { constants, zstdCompress, zstdDecompress } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(zstdCompress);
const decompress = promisify(zstdDecompress);

export type EncodedRecord = {
  codec: "raw" | "zstd";
  data: Buffer;
  rawSize: number;
};

// Application-level encoding: neither this module nor its format depends on SQL.
export async function encodeRecord(
  bytes: Uint8Array,
  checkpoint: boolean,
): Promise<EncodedRecord> {
  const raw = Buffer.from(bytes);
  if (!checkpoint && raw.length < 1024)
    return { codec: "raw", data: raw, rawSize: raw.length };
  const compressed = await compress(raw, {
    params: { [constants.ZSTD_c_compressionLevel]: 1 },
  });
  return checkpoint || compressed.length < raw.length
    ? { codec: "zstd", data: compressed, rawSize: raw.length }
    : { codec: "raw", data: raw, rawSize: raw.length };
}

export async function decodeRecord(record: EncodedRecord): Promise<Uint8Array> {
  if (!Number.isSafeInteger(record.rawSize) || record.rawSize <= 0)
    throw new Error("Invalid document record size");
  const bytes =
    record.codec === "raw"
      ? record.data
      : record.codec === "zstd"
        ? await decompress(record.data, { maxOutputLength: record.rawSize })
        : undefined;
  if (!bytes || bytes.length !== record.rawSize)
    throw new Error("Invalid document record");
  return bytes;
}
