import { useEffect, useRef, useState } from "react";
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
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const [scrollWidth, setScrollWidth] = useState(0);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    const tableScroll = content.querySelector<HTMLElement>("[data-table-scroll-container]") ?? content;
    const scrollbar = scrollbarRef.current;
    const updateScrollbar = () => {
      setScrollWidth(tableScroll.scrollWidth);
      setHasHorizontalOverflow(tableScroll.scrollWidth > tableScroll.clientWidth + 1);
      if (scrollbar) scrollbar.scrollLeft = tableScroll.scrollLeft;
    };
    const syncFromTable = () => {
      if (scrollbar && scrollbar.scrollLeft !== tableScroll.scrollLeft) scrollbar.scrollLeft = tableScroll.scrollLeft;
    };
    const syncFromScrollbar = () => {
      if (scrollbar && tableScroll.scrollLeft !== scrollbar.scrollLeft) tableScroll.scrollLeft = scrollbar.scrollLeft;
    };

    updateScrollbar();
    const resizeObserver = new ResizeObserver(updateScrollbar);
    resizeObserver.observe(content);
    resizeObserver.observe(tableScroll);
    tableScroll.addEventListener("scroll", syncFromTable);
    scrollbar?.addEventListener("scroll", syncFromScrollbar);

    return () => {
      resizeObserver.disconnect();
      tableScroll.removeEventListener("scroll", syncFromTable);
      scrollbar?.removeEventListener("scroll", syncFromScrollbar);
    };
  }, [children, hasHorizontalOverflow]);

  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <div
        ref={contentRef}
        className="overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
        style={{ maxHeight }}
      >
        {children}
      </div>
      {hasHorizontalOverflow && (
        <div
          ref={scrollbarRef}
          className="h-4 overflow-x-scroll overflow-y-hidden border-t bg-muted/30 [scrollbar-gutter:stable]"
          aria-label="Горизонтальная прокрутка таблицы"
        >
          <div style={{ width: scrollWidth, height: 1 }} />
        </div>
      )}
    </div>
  );
}
