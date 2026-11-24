import type { ComponentProps, ElementType } from "react";

export { cn } from "cn";

export type StyledComponentProps<Component extends ElementType> = Omit<
  ComponentProps<Component>,
  "className"
> & { className?: string };
