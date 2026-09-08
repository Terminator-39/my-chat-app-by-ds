import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startChat, startChatStream } from '../../src/api/chat'

const { postMock } = vi.hoisted(() => ({ postMock: vi.fn() }))
vi.mock('../../src/api/http', () => ({ default: { post: postMock } }))

describe('startChat（非流式）', () => {
  beforeEach(() => {
    postMock.mockReset()
  })

  it('向聊天接口 POST 载荷并返回 data', async () => {
    postMock.mockResolvedValue({
      data: { session_id: 's1', text: '你好' },
    })
    const res = await startChat({
      prompt: '你好',
      session_id: 's1',
    })
    expect(postMock).toHaveBeenCalledWith(
      '/api/chat/deepseek/start_chat',
      { prompt: '你好', session_id: 's1' },
    )
    expect(res).toEqual({ session_id: 's1', text: '你好' })
  })
})

describe('startChatStream（流式）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('以 JSON 请求体调用流式接口并透传 Response', async () => {
    const fakeRes = { ok: true, status: 200 }
    const fetchMock = vi.fn().mockResolvedValue(fakeRes)
    vi.stubGlobal('fetch', fetchMock)

    const payload = [
      { role: 'user' as const, content: 'hi' },
      { role: 'assistant' as const, content: 'hello' },
    ]
    const res = await startChatStream(payload)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/chat/deepseek/stream_chat')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual(payload)
    expect(res).toBe(fakeRes)
  })
})
