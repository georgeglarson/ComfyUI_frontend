import axios from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchRemoteRoute } from '@/renderer/extensions/vueNodes/widgets/utils/fetchRemoteRoute'
import type { AuthHeader } from '@/types/authTypes'

const COMFY_API_BASE = 'https://api.example.test'

const mockAuth = vi.hoisted(() => ({
  authHeader: null as AuthHeader | null
}))

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof axios>()
  return {
    default: {
      ...actual,
      get: vi.fn()
    }
  }
})

vi.mock('@/config/comfyApi', () => ({
  getComfyApiBaseUrl: () => COMFY_API_BASE
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: vi.fn(() => ({
    getAuthHeader: vi.fn(() => Promise.resolve(mockAuth.authHeader))
  }))
}))

describe('fetchRemoteRoute', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    mockAuth.authHeader = null
    vi.clearAllMocks()
  })

  it('uses the route as-is when useComfyApi is not set', async () => {
    await fetchRemoteRoute('/voices')
    const [url] = vi.mocked(axios.get).mock.calls[0]
    expect(url).toBe('/voices')
  })

  it('passes through absolute URLs unchanged when useComfyApi is false', async () => {
    await fetchRemoteRoute('https://other.example/voices', {
      useComfyApi: false
    })
    const [url] = vi.mocked(axios.get).mock.calls[0]
    expect(url).toBe('https://other.example/voices')
  })

  it('prepends the comfy api base URL when useComfyApi is true', async () => {
    await fetchRemoteRoute('/voices', { useComfyApi: true })
    const [url] = vi.mocked(axios.get).mock.calls[0]
    expect(url).toBe(`${COMFY_API_BASE}/voices`)
  })

  it('injects the auth header when useComfyApi is true and one is available', async () => {
    mockAuth.authHeader = { Authorization: 'Bearer token-123' }
    await fetchRemoteRoute('/voices', { useComfyApi: true })
    const [, config] = vi.mocked(axios.get).mock.calls[0]
    expect(config?.headers).toEqual({ Authorization: 'Bearer token-123' })
  })

  it('does not set headers when useComfyApi is true but no auth header is available', async () => {
    mockAuth.authHeader = null
    await fetchRemoteRoute('/voices', { useComfyApi: true })
    const [, config] = vi.mocked(axios.get).mock.calls[0]
    expect(config?.headers).toBeUndefined()
  })

  it('does not inject auth headers when useComfyApi is false', async () => {
    mockAuth.authHeader = { Authorization: 'Bearer token-123' }
    await fetchRemoteRoute('/voices', { useComfyApi: false })
    const [, config] = vi.mocked(axios.get).mock.calls[0]
    expect(config?.headers).toBeUndefined()
  })

  it('forwards params, timeout and signal to axios while stripping useComfyApi', async () => {
    const controller = new AbortController()
    await fetchRemoteRoute('/voices', {
      useComfyApi: true,
      params: { page: '2', page_size: '10' },
      timeout: 5000,
      signal: controller.signal
    })
    const [, config] = vi.mocked(axios.get).mock.calls[0]
    expect(config?.params).toEqual({ page: '2', page_size: '10' })
    expect(config?.timeout).toBe(5000)
    expect(config?.signal).toBe(controller.signal)
    expect(
      (config as Record<string, unknown> | undefined)?.useComfyApi
    ).toBeUndefined()
  })

  it('returns the axios response', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data: { items: [1, 2] } })
    const res = await fetchRemoteRoute('/voices')
    expect(res.data).toEqual({ items: [1, 2] })
  })
})
