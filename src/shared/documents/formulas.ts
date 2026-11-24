import type { FUniver } from "@univerjs/core/facade";
import type { Snapshot } from "./model";

export function hasFormulas(data: Snapshot) {
  return data.sheetOrder.some((id: string) =>
    Object.values(data.sheets[id].cellData ?? {}).some((row: any) =>
      Object.values(row).some((cell: any) => cell?.f),
    ),
  );
}

export async function recalculate(api: FUniver, timeoutMessage: string) {
  const formula = api.getFormula();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      subscription.dispose();
      reject(new Error(timeoutMessage));
    }, 10000);
    const subscription = formula.calculationEnd((state) => {
      if (state !== 3) return;
      clearTimeout(timer);
      subscription.dispose();
      queueMicrotask(resolve);
    });
    formula.executeCalculation();
  });
}
