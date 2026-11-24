import { newId } from "../../shared/id";
import { LocaleType, type IWorkbookData } from "@univerjs/presets";

export function createBlank(): Partial<IWorkbookData> {
  const id = newId();
  const sheetId = newId();
  return {
    id,
    name: "New spreadsheet",
    locale: LocaleType.EN_US,
    appVersion: "1.5.0",
    styles: {},
    sheetOrder: [sheetId],
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: "Sheet 1",
        rowCount: 500,
        columnCount: 26,
        defaultRowHeight: 28,
        defaultColumnWidth: 120,
        cellData: {},
      },
    },
  };
}
