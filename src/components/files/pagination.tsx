import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
} from "../ui/pagination";

export function FilePagination({
  offset,
  hasMore,
  onChange,
}: {
  offset: number;
  hasMore: boolean;
  onChange: (offset: number) => void;
}) {
  const previous = offset > 0;
  if (!previous && !hasMore) return null;
  return (
    <Pagination aria-label="File and job pages">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            href="#"
            aria-disabled={!previous}
            tabIndex={previous ? 0 : -1}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={(event) => {
              event.preventDefault();
              if (previous) onChange(Math.max(0, offset - 50));
            }}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink
            href="#"
            isActive
            aria-label={`Page ${Math.floor(offset / 50) + 1}`}
            onClick={(event) => event.preventDefault()}
          >
            {Math.floor(offset / 50) + 1}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            href="#"
            aria-disabled={!hasMore}
            tabIndex={hasMore ? 0 : -1}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
            onClick={(event) => {
              event.preventDefault();
              if (hasMore) onChange(offset + 50);
            }}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
