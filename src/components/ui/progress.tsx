"use client";

import type { StyledComponentProps } from "@/lib/utils";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";

function Progress({
  className,
  value = null,
  ...props
}: StyledComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value}
      className={className}
      {...props}
    >
      <ProgressPrimitive.Track className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <ProgressPrimitive.Indicator
          data-slot="progress-indicator"
          className="bg-primary transition-all"
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  );
}

export { Progress };
