import axios from 'axios'

import type { RemoteComboConfig } from '@/schemas/nodeDefSchema'

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 16000

/**
 * Build a stable cache key for a remote combo configuration.
 *
 * Non-comfy-api routes intentionally share cache across users on the same
 * machine; comfy-api routes are partitioned per user via `userId`. Pass the
 * caller's resolved userId (or null/undefined) — keeping the dependency on
 * the auth store outside this helper makes it pure and trivially testable.
 */
export function buildCacheKey(
  config: RemoteComboConfig,
  userId?: string | null
): string {
  const params = new URLSearchParams({
    route: config.route,
    useComfyApi: config.use_comfy_api ? '1' : '0',
    responseKey: config.response_key ?? '',
    pageSize: String(config.page_size ?? 0)
  })
  if (config.use_comfy_api) {
    params.set('u', userId ?? 'anon')
  }
  return `https://cache.comfy.invalid/?${params}`
}

/**
 * Exponential backoff in milliseconds, capped at 16s. `count` is the
 * number of failed attempts so far (1-indexed for the first retry).
 */
export function getBackoff(count: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, count), BACKOFF_CAP_MS)
}

/**
 * Distinguish transient errors (worth retrying) from permanent ones.
 * 401/403/404 etc. won't fix themselves — retrying wastes time.
 * Network-level failures (no response) are treated as retriable.
 */
export function isRetriableError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return true
  const status = err.response?.status
  if (status == null) return true
  if (status >= 500) return true
  return status === 408 || status === 429
}
