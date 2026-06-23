import { cn } from "@/lib/utils";

interface StickyScrollTableProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string;
}

/**
 * Wraps a table so that BOTH the vertical and horizontal scrollbars
 * are always visible within the container — the user never has to scroll
 * to the bottom of the page to reach the horizontal scrollbar.
 *
 * The container height is capped at `maxHeight` (default calc(100vh-420px)).
 * `overflow-auto` shows both scrollbars as soon as content overflows.
 */
export function StickyScrollTable({
  children,
  className,
  maxHeight = "calc(100vh - 420px)",
}: StickyScrollTableProps) {
  return (
    <div
      className={cn("overflow-auto rounded-md border", className)}
      style={{ maxHeight }}
    >
      {children}
    </div>
  );
}
