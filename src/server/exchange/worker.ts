import { importOffice, exportOffice, normalizeImported } from "./codecs";

process.on("message", async (message: any) => {
  const { id, method, input } = message;
  try {
    let result: any;
    if (method === "import")
      result = await importOffice(
        input.kind,
        input.format,
        Buffer.from(input.base64, "base64"),
        input.options,
      );
    else if (method === "export") {
      const exported = await exportOffice(
        input.kind,
        input.format,
        input.snapshot,
        input.options,
        input.original ? Buffer.from(input.original, "base64") : undefined,
      );
      result = {
        ...exported,
        data: undefined,
        base64: Buffer.from(exported.data).toString("base64"),
      };
    } else if (method === "normalize")
      result = await normalizeImported(
        input.kind,
        input.snapshot,
        input.extras,
      );
    else throw new Error("UNKNOWN_EXCHANGE_METHOD");
    process.send?.({ id, result });
  } catch (error) {
    process.send?.({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

process.on("disconnect", () => process.exit(0));
