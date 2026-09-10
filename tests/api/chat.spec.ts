import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getConversation,
  getConversations,
  startChat,
  startChatStream,
} from '../../src/api/chat'

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
    expect(init.signal).toBeUndefined()
    expect(JSON.parse(init.body as string)).toEqual(payload)
    expect(res).toBe(fakeRes)
  })

  it('将 AbortSignal 传给 fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()

    await startChatStream([{ role: 'user', content: 'hi' }], controller.signal)

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })

  it('重连时发送同一个 requestId 和 Last-Event-ID，并携带登录令牌', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('access_token', 'token-abc')

    await startChatStream(
      [{ role: 'user', content: 'hi', sessionId: 'session-1' }],
      undefined,
      { requestId: 'request-1', lastEventId: 3 },
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      '/api/chat/deepseek/stream_chat?requestId=request-1&sessionId=session-1',
    )
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer token-abc',
      'Last-Event-ID': '3',
    })
  })

  it('读取会话列表和指定会话历史时携带登录令牌', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: [{ id: 's1', title: '会话一' }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 200,
            message: 'success',
            data: { id: 's1', title: '会话一', messages: [] },
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    localStorage.setItem('access_token', 'token-abc')

    expect(await getConversations()).toEqual([{ id: 's1', title: '会话一' }])
    expect(await getConversation('会话/一')).toEqual({
      id: 's1',
      title: '会话一',
      messages: [],
    })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/chat/deepseek/conversations')
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      Authorization: 'Bearer token-abc',
    })
    expect(fetchMock.mock.calls[1][0]).toBe(
      '/api/chat/deepseek/conversations/%E4%BC%9A%E8%AF%9D%2F%E4%B8%80',
    )
  })
})
