import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import type { RemoteComboConfig } from '@/schemas/nodeDefSchema'

import {
  buildCacheKey,
  getBackoff,
  isRetriableError
} from '@/renderer/extensions/vueNodes/widgets/utils/richComboHelpers'

const baseConfig: RemoteComboConfig = {
  route: '/voices',
  item_schema: {
    value_field: 'id',
    label_field: 'name',
    preview_type: 'image'
  }
}

function parseKey(key: string): URLSearchParams {
  return new URL(key).searchParams
}

describe('buildCacheKey', () => {
  it('encodes the route, response_key and page_size', () => {
    const params = parseKey(
      buildCacheKey({
        ...baseConfig,
        route: '/voices',
        response_key: 'data.items',
        page_size: 50
      })
    )
    expect(params.get('route')).toBe('/voices')
    expect(params.get('responseKey')).toBe('data.items')
    expect(params.get('pageSize')).toBe('50')
  })

  it('encodes use_comfy_api as a 0/1 flag', () => {
    expect(parseKey(buildCacheKey(baseConfig)).get('useComfyApi')).toBe('0')
    expect(
      parseKey(buildCacheKey({ ...baseConfig, use_comfy_api: true }, 'u1')).get(
        'useComfyApi'
      )
    ).toBe('1')
  })

  it('partitions by userId only when use_comfy_api is true', () => {
    const comfyA = buildCacheKey(
      { ...baseConfig, use_comfy_api: true },
      'user-a'
    )
    const comfyB = buildCacheKey(
      { ...baseConfig, use_comfy_api: true },
      'user-b'
    )
    expect(comfyA).not.toBe(comfyB)
    expect(parseKey(comfyA).get('u')).toBe('user-a')
    expect(parseKey(comfyB).get('u')).toBe('user-b')
  })

  it('shares the cache across users when use_comfy_api is false', () => {
    const a = buildCacheKey(baseConfig, 'user-a')
    const b = buildCacheKey(baseConfig, 'user-b')
    expect(a).toBe(b)
    expect(parseKey(a).has('u')).toBe(false)
  })

  it('falls back to "anon" when use_comfy_api is true and userId is missing', () => {
    expect(
      parseKey(buildCacheKey({ ...baseConfig, use_comfy_api: true }, null)).get(
        'u'
      )
    ).toBe('anon')
    expect(
      parseKey(buildCacheKey({ ...baseConfig, use_comfy_api: true })).get('u')
    ).toBe('anon')
  })

  it('treats missing optional fields as empty / 0 so the key stays stable', () => {
    const params = parseKey(buildCacheKey(baseConfig))
    expect(params.get('responseKey')).toBe('')
    expect(params.get('pageSize')).toBe('0')
  })
})

describe('getBackoff', () => {
  it('grows exponentially from 1s', () => {
    expect(getBackoff(1)).toBe(2000)
    expect(getBackoff(2)).toBe(4000)
    expect(getBackoff(3)).toBe(8000)
    expect(getBackoff(4)).toBe(16000)
  })

  it('caps at 16s for higher attempt counts', () => {
    expect(getBackoff(5)).toBe(16000)
    expect(getBackoff(10)).toBe(16000)
    expect(getBackoff(100)).toBe(16000)
  })
})

describe('isRetriableError', () => {
  function axiosErrorWithStatus(status: number): AxiosError {
    return new AxiosError(
      `HTTP ${status}`,
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      {
        status,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: null
      }
    )
  }

  it('retries non-axios errors (e.g. unexpected throws)', () => {
    expect(isRetriableError(new Error('boom'))).toBe(true)
    expect(isRetriableError('string error')).toBe(true)
    expect(isRetriableError(undefined)).toBe(true)
  })

  it('retries axios errors with no response (network failures)', () => {
    const err = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(isRetriableError(err)).toBe(true)
  })

  it('retries 5xx responses', () => {
    expect(isRetriableError(axiosErrorWithStatus(500))).toBe(true)
    expect(isRetriableError(axiosErrorWithStatus(502))).toBe(true)
    expect(isRetriableError(axiosErrorWithStatus(503))).toBe(true)
  })

  it('retries 408 (request timeout) and 429 (too many requests)', () => {
    expect(isRetriableError(axiosErrorWithStatus(408))).toBe(true)
    expect(isRetriableError(axiosErrorWithStatus(429))).toBe(true)
  })

  it('does not retry other 4xx responses', () => {
    expect(isRetriableError(axiosErrorWithStatus(400))).toBe(false)
    expect(isRetriableError(axiosErrorWithStatus(401))).toBe(false)
    expect(isRetriableError(axiosErrorWithStatus(403))).toBe(false)
    expect(isRetriableError(axiosErrorWithStatus(404))).toBe(false)
  })
})
