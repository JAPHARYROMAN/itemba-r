export function paginatedResponse<T>(input: {
  data: T[];
  total: number;
  page: number;
  limit: number;
}) {
  const totalPages = Math.ceil(input.total / input.limit);
  return {
    data: input.data,
    items: input.data,
    total: input.total,
    page: input.page,
    limit: input.limit,
    totalPages,
  };
}
