/*
 * @Author: wlong
 * @Date: 2026-09-09 20:48:05
 * @LastEditTime: 2026-09-09 21:53:05
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/src/utils/chat-stream.ts
 */
export interface ChatStreamOptions {
  onChunk?: (content: string) => void
  onEvent?: (content: string, eventId: number) => void
  signal?: AbortSignal
}

export interface ChatStreamResult {
  lastEventId: number
  completed: boolean
}

export class ChatStreamServerError extends Error {}

/**
 * 读取并解析聊天接口的 SSE 响应。
 * 网络 chunk 不等于 SSE 事件：JSON、换行符甚至 UTF-8 字符都可能被切开，
 * 所以必须先累积文本，再按空行拆出完整事件。
 * @param response fetch 返回的 SSE 响应
 * @param options 事件回调、取消信号和解析配置
 * @returns 最后收到的事件 ID及流是否正常结束
 */
export async function readChatStream(
  response: Response,
  { onChunk, onEvent, signal }: ChatStreamOptions,
): Promise<ChatStreamResult> {
  if (!response.body) throw new Error('流式响应没有响应体')

  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let finished = false
  let lastEventId = 0

  /**
   * @description: 通过一系列的数据清洗、格式解析和条件判断，将原始的字符串事件转化为上层业务可直接使用的文本片段
   * @param {string} event
   * @return {*}
   */
  const handleEvent = (event: string) => {
    const lines = event.split(/\r?\n/)
    const idLine = lines.find((line) => line.startsWith('id:'))
    const eventId = idLine ? Number(idLine.replace(/^id:\s?/, '')) : 0
    if (Number.isInteger(eventId) && eventId > 0) lastEventId = eventId

    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.replace(/^data:\s?/, ''))
      .join('\n')

    if (!data) return
    if (data === '[DONE]') {
      finished = true
      return
    }

    // 后端当前返回 OpenAI/DeepSeek 风格的 delta，只把真正的文本向上层暴露。
    const json = JSON.parse(data) as {
      error?: string
      choices?: Array<{ delta?: { content?: string } }>
    }
    if (json.error) throw new ChatStreamServerError(json.error)
    const content = json.choices?.[0]?.delta?.content
    if (content) {
      onChunk?.(content)
      onEvent?.(content, lastEventId)
    }
  }

  const abortHandler = () => {
    // fetch 的 signal 负责终止请求；这里额外 cancel reader，确保响应已经到达后
    // signal 再触发时，挂起的 reader.read() 也能尽快结束。
    void reader.cancel()
  }

  signal?.addEventListener('abort', abortHandler, { once: true })
  try {
    while (!finished) {
      const { done, value } = await reader.read() //  通过读取器(reader)读取下一个数据块 解构获取done和value两个属性 done: 表示是否还有更多数据可读的布尔值 value: 当前读取到的数据块内容
      if (done) break

      // stream:true 让跨 chunk 的多字节中文字符在下一块到达后再解码。
      buffer += decoder.decode(value, { stream: true })

      // 兼容 LF 和 CRLF；不完整事件留在 buffer，等待下一个网络 chunk。
      // todo 存在O(N)->O(1)的性能优化方向，避免buffer重新被赋值，通过记录原始 buffer 以及每次匹配到的separatorIndex,计算相应的内容块的指针偏移量offset
      let separatorIndex = buffer.search(/\r?\n\r?\n/)
      while (separatorIndex >= 0 && !finished) {
        const separator = buffer.match(/\r?\n\r?\n/)![0]
        handleEvent(buffer.slice(0, separatorIndex))
        buffer = buffer.slice(separatorIndex + separator.length)
        separatorIndex = buffer.search(/\r?\n\r?\n/)
      }
    }

    // 服务端可能在连接结束时没有补最后一个空行，不能丢掉这段事件。
    buffer += decoder.decode()
    if (!finished && buffer.trim()) handleEvent(buffer)
  } finally {
    signal?.removeEventListener('abort', abortHandler)
    // 释放读取器的锁
    reader.releaseLock()
  }

  return { lastEventId, completed: finished }
}
