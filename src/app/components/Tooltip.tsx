import type { ReactNode } from "react";

import {
  Tooltip as TooltipRoot,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Convenience wrapper over the shadcn/Radix tooltip so existing call sites can keep the
 * simple `<Tooltip content={...}>trigger</Tooltip>` shape. Radix handles portaling and
 * positioning, so it escapes the tables' overflow clipping for free.
 */
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <TooltipRoot>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 outline-none">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </TooltipRoot>
  );
}
