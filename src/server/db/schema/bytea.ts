import { customType } from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; driverData: Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => Buffer.isBuffer(value) ? value : Buffer.from(value),
});
