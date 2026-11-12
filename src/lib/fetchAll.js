// The database returns at most 1,000 rows per request. For money figures a silently truncated list would give
// wrong opening balances, so keep asking until a short page comes back. makeQuery must return a FRESH query
// each time and should include a stable .order().
export async function fetchAll(makeQuery, pageSize = 1000, maxPages = 200) {
  const rows = []
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await makeQuery().range(page * pageSize, page * pageSize + pageSize - 1)
    if (error) return { data: rows, error }
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return { data: rows, error: null }
  }
  return { data: rows, error: new Error('Too many rows to load') }
}
