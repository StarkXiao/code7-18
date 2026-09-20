export interface PaginationParams {
  page: number;
  pageSize: number;
}

export function parsePagination(query: Record<string, unknown>): PaginationParams {
  const page = Math.max(1, Math.trunc(Number(query.page ?? 1)) || 1);
  const pageSizeRaw = Math.trunc(Number(query.pageSize ?? 20)) || 20;
  const pageSize = Math.min(200, Math.max(1, pageSizeRaw));
  return { page, pageSize };
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function buildPage<T>(items: T[], total: number, params: PaginationParams): Page<T> {
  return {
    items,
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  };
}
