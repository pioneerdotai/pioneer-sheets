import * as inspection from "../inspection";
import { calculateSnapshot } from "../calculation";
import type { IdentityReference } from "../../../shared/types";
import { ServiceError } from "../error";
import { OfficeService } from "../service";
import { Operation, applyOperation } from "./operations";

export class OfficeAI {
  constructor(public service: OfficeService) {}
  inspect(
    id: string,
    who: IdentityReference,
    options: {
      sheet?: string;
      range?: string;
      start?: number;
      end?: number;
      query?: string;
    } = {},
  ) {
    return inspection.inspect(this.service, id, who, options);
  }
  async execute(
    id: string,
    who: IdentityReference,
    operations: Operation[],
    requestId?: string,
    expectedRevision?: number,
  ) {
    if (
      !Array.isArray(operations) ||
      !operations.length ||
      operations.length > 200
    )
      throw new ServiceError(400, "Provide between 1 and 200 operations");
    const result = await this.service.mutate(
      id,
      who,
      async (s) => {
        for (const op of operations) {
          if (
            this.service.kind === "sheet" &&
            [
              "insert_rows",
              "delete_rows",
              "insert_columns",
              "delete_columns",
            ].includes(op.op)
          ) {
            const checked = structuredClone(s);
            applyOperation(checked, op, this.service.kind);
            const changed = await calculateSnapshot(s, op as any);
            Object.assign(s, changed);
            s.$axisEdits = checked.$axisEdits;
          } else applyOperation(s, structuredClone(op), this.service.kind);
        }
        if (this.service.kind === "sheet") {
          const edits = s.$axisEdits;
          const calculated = await calculateSnapshot(s);
          Object.assign(s, calculated);
          if (edits) s.$axisEdits = edits;
        }
      },
      `Agent: ${operations.map((o) => o.op).join(", ")}`,
      requestId,
      expectedRevision,
    );
    return { ...result, documentId: id };
  }
}
