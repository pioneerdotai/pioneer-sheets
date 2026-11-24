import { useState, useRef, useEffect, useId } from "react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog";
import { Input } from "./input";
import { Field, FieldLabel } from "./field";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "./alert-dialog";

/** Promise-based application flow composed from shadcn Dialog and form controls. */
export function useDialog() {
  const inputId = useId();
  const [dialog, setDialog] = useState<{
    title: string;
    initial?: string;
  } | null>(null);
  const pending = useRef<((value: string | null) => void) | null>(null);
  useEffect(
    () => () => {
      pending.current?.(null);
    },
    [],
  );
  const finish = (value: string | null) => {
    pending.current?.(value);
    pending.current = null;
    setDialog(null);
  };
  const ask = (title: string, initial?: string) =>
    new Promise<string | null>((resolve) => {
      pending.current?.(null);
      pending.current = resolve;
      setDialog({ title, initial });
    });
  const modal = (
    <>
      <AlertDialog
        open={dialog !== null && dialog.initial === undefined}
        onOpenChange={(open) => {
          if (!open) finish(null);
        }}
      >
        <AlertDialogContent className="sheets-chrome">
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm this action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => finish(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => finish("confirmed")}>
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog
        open={dialog?.initial !== undefined}
        onOpenChange={(open) => {
          if (!open) finish(null);
        }}
      >
        {dialog?.initial !== undefined && (
          <DialogContent className="sheets-chrome sm:max-w-md">
            <form
              className="grid gap-6"
              onSubmit={(event) => {
                event.preventDefault();
                finish(
                  String(
                    new FormData(event.currentTarget).get("value") ?? "",
                  ).trim(),
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>{dialog.title}</DialogTitle>
                <DialogDescription>Enter a new name.</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor={inputId}>{dialog.title}</FieldLabel>
                <Input
                  id={inputId}
                  autoFocus
                  name="value"
                  defaultValue={dialog.initial}
                  required
                />
              </Field>
              <DialogFooter>
                <Button
                  variant="outline"
                  type="button"
                  onClick={() => finish(null)}
                >
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
  return { ask, modal };
}
