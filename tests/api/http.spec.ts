import { afterEach, describe, expect, it, vi } from 'vitest'
import http from '../../src/api/http'

/** 用一个自定义 adapter 截获请求配置，避免真实网络请求 */
function createAdapter() {
  const adapter = vi.fn(
    async (config: Record<string, unknown>) => ({
      data: { ok: true },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }),
  )
  const request = (config: Record<string, unknown> = {}) =>
    http.get('/api/test', { ...config, adapter } as never)
  return { adapter, request }
}

function readHeader(headers: Record<string, unknown>, name: string) {
  const get =
    typeof (headers as { get?: (k: string) => unknown }).get === 'function'
      ? (headers as { get: (k: string) => unknown }).get(name)
      : undefined
  return get ?? headers[name]
}

describe('http 实例（请求拦截器）', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('请求默认携带 JSON Content-Type', async () => {
    const { adapter, request } = createAdapter()
    await request()
    const headers = adapter.mock.calls[0][0].headers as Record<
      string,
      unknown
    >
    expect(readHeader(headers, 'Content-Type')).toBe('application/json')
  })

  it('localStorage 存在 access_token 时自动附加 Authorization', async () => {
    localStorage.setItem('access_token', 'token-abc')
    const { adapter, request } = createAdapter()
    await request()
    const headers = adapter.mock.calls[0][0].headers as Record<
      string,
      unknown
    >
    expect(readHeader(headers, 'Authorization')).toBe('Bearer token-abc')
  })

  it('无 token 时不附加 Authorization', async () => {
    const { adapter, request } = createAdapter()
    await request()
    const headers = adapter.mock.calls[0][0].headers as Record<
      string,
      unknown
    >
    expect(readHeader(headers, 'Authorization')).toBeUndefined()
  })
})
