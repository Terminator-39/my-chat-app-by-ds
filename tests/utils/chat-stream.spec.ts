import { describe, expect, it } from 'vitest'
import { readChatStream } from '../../src/utils/chat-stream'

const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`

function response(chunks: Array<string | Uint8Array>) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) =>
        controller.enqueue(
          typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
        ),
      )
      controller.close()
    },
  })
  return new Response(stream)
}

describe('readChatStream', () => {
  it('处理被网络 chunk 切开的 SSE 和 UTF-8 字符', async () => {
    const chunks: string[] = []
    const firstEvent = new TextEncoder().encode(event('你'))
    const utf8Start = firstEvent.findIndex((byte) => byte >= 128)
    await readChatStream(
      response([
        firstEvent.slice(0, utf8Start + 1),
        firstEvent.slice(utf8Start + 1),
        event('好') + 'data: [DONE]\n\n',
      ]),
      { onChunk: (chunk) => chunks.push(chunk) },
    )
    expect(chunks.join('')).toBe('你好')
  })

  it('兼容 CRLF，并处理连接结束时没有空行的最后事件', async () => {
    const chunks: string[] = []
    await readChatStream(
      response([
        event('早').replaceAll('\n', '\r\n'),
        event('安').replaceAll('\n', '\r\n').trimEnd(),
      ]),
      { onChunk: (chunk) => chunks.push(chunk) },
    )
    expect(chunks.join('')).toBe('早安')
  })

  it('AbortSignal 触发时取消 reader', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true
      },
    })
    const controller = new AbortController()
    const pending = readChatStream(new Response(stream), {
      signal: controller.signal,
      onChunk: () => undefined,
    })
    controller.abort()
    await pending
    expect(cancelled).toBe(true)
  })
})
