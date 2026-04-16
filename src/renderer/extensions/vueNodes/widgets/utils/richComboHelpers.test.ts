import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import type { RemoteComboConfig } from '@/schemas/nodeDefSchema'

import {
  buildCacheKey,
  getBackoff,
  isRetriableError,
  summarizeError,
  summarizePayload
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

  it('partitions by authScope only when use_comfy_api is true', () => {
    const comfyA = buildCacheKey(
      { ...baseConfig, use_comfy_api: true },
      'ws:team-a'
    )
    const comfyB = buildCacheKey(
      { ...baseConfig, use_comfy_api: true },
      'ws:team-b'
    )
    expect(comfyA).not.toBe(comfyB)
    expect(parseKey(comfyA).get('u')).toBe('ws:team-a')
    expect(parseKey(comfyB).get('u')).toBe('ws:team-b')
  })

  it('shares the cache across auth scopes when use_comfy_api is false', () => {
    const a = buildCacheKey(baseConfig, 'fb:user-a')
    const b = buildCacheKey(baseConfig, 'fb:user-b')
    expect(a).toBe(b)
    expect(parseKey(a).has('u')).toBe(false)
  })

  it('treats workspace, firebase, and api-key scopes as distinct buckets', () => {
    const ws = buildCacheKey({ ...baseConfig, use_comfy_api: true }, 'ws:abc')
    const fb = buildCacheKey({ ...baseConfig, use_comfy_api: true }, 'fb:abc')
    const apikey = buildCacheKey(
      { ...baseConfig, use_comfy_api: true },
      'apikey'
    )
    expect(new Set([ws, fb, apikey]).size).toBe(3)
  })

  it('falls back to "anon" when use_comfy_api is true and authScope is missing', () => {
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

describe('summarizeError', () => {
  it('extracts message, code and status from an axios error', () => {
    const err = new AxiosError(
      'Request failed',
      'ERR_BAD_RESPONSE',
      undefined,
      undefined,
      {
        status: 500,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: null
      }
    )
    expect(summarizeError(err)).toEqual({
      message: 'Request failed',
      code: 'ERR_BAD_RESPONSE',
      status: 500
    })
  })

  it('does not include axios config, headers, request or response data', () => {
    const authedConfig = {
      url: '/voices',
      method: 'get',
      headers: new AxiosHeaders({ Authorization: 'Bearer SECRET-TOKEN-123' })
    }
    const err = new AxiosError(
      'Request failed',
      'ERR_BAD_RESPONSE',
      authedConfig,
      undefined,
      {
        status: 500,
        statusText: '',
        headers: { 'set-cookie': ['session=PRIVATE'] },
        config: authedConfig,
        data: { user_email: 'private@example.com' }
      }
    )
    const summary = summarizeError(err)

    expect(JSON.stringify(summary)).not.toContain('SECRET-TOKEN-123')
    expect(JSON.stringify(summary)).not.toContain('PRIVATE')
    expect(JSON.stringify(summary)).not.toContain('private@example.com')
    expect(summary).not.toHaveProperty('config')
    expect(summary).not.toHaveProperty('request')
    expect(summary).not.toHaveProperty('response')
  })

  it('reports an axios network error with no response as undefined status', () => {
    const err = new AxiosError('Network Error', 'ERR_NETWORK')
    expect(summarizeError(err)).toEqual({
      message: 'Network Error',
      code: 'ERR_NETWORK',
      status: undefined
    })
  })

  it('summarizes a plain Error using its name and message', () => {
    expect(summarizeError(new TypeError('boom'))).toEqual({
      message: 'boom',
      name: 'TypeError'
    })
  })

  it('coerces non-Error throwables to a message string', () => {
    expect(summarizeError('oops')).toEqual({ message: 'oops' })
    expect(summarizeError(42)).toEqual({ message: '42' })
    expect(summarizeError(null)).toEqual({ message: 'null' })
    expect(summarizeError(undefined)).toEqual({ message: 'undefined' })
  })
})

describe('summarizePayload', () => {
  it('reports array length without exposing values', () => {
    expect(
      summarizePayload([{ secret: 'a' }, { secret: 'b' }, { secret: 'c' }])
    ).toEqual({
      type: 'array',
      length: 3
    })
  })

  it('reports object keys without exposing values', () => {
    expect(
      summarizePayload({ user_email: 'private@example.com', voices: ['x'] })
    ).toEqual({
      type: 'object',
      keys: ['user_email', 'voices'],
      keyCount: 2
    })
  })

  it('caps the keys sample at 10 but reports the full key count', () => {
    const big: Record<string, number> = {}
    for (let i = 0; i < 25; i++) big[`k${i}`] = i
    const summary = summarizePayload(big) as {
      type: string
      keys: string[]
      keyCount: number
    }
    expect(summary.type).toBe('object')
    expect(summary.keys).toHaveLength(10)
    expect(summary.keyCount).toBe(25)
  })

  it('distinguishes null and undefined', () => {
    expect(summarizePayload(null)).toEqual({ type: 'null' })
    expect(summarizePayload(undefined)).toEqual({ type: 'undefined' })
  })

  it('reports primitive types without their value', () => {
    expect(summarizePayload('hello')).toEqual({ type: 'string' })
    expect(summarizePayload(123)).toEqual({ type: 'number' })
    expect(summarizePayload(true)).toEqual({ type: 'boolean' })
  })
})
