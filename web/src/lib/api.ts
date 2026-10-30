/* eslint-disable @typescript-eslint/no-explicit-any */
export class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, credentials: 'same-origin', cache: 'no-store', headers: {} }
  if (body !== undefined) { (opts.headers as Record<string, string>)['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body) }
  const r = await fetch(path, opts)
  const t = await r.text()
  let j: any = null
  try { j = t ? JSON.parse(t) : null } catch { j = null }
  if (!r.ok) {
    if (r.status === 401) {
      let last = 0; try { last = Number(sessionStorage.getItem('shift401') || 0) } catch { /* */ }
      if (Date.now() - last > 60000) { try { sessionStorage.setItem('shift401', String(Date.now())) } catch { /* */ } location.reload() }
    }
    const m = (j && (j.error || j.message)) || (t && t.trim().slice(0, 200)) || `${r.status} ${r.statusText}`
    throw new ApiError(typeof m === 'string' ? m : JSON.stringify(m), r.status)
  }
  return j as T
}
