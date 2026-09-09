import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Chat from '../../src/views/chat.vue'

// mock 掉 api 层，避免测试环境真实发起网络请求
const { startChatStreamMock } = vi.hoisted(() => ({
  startChatStreamMock: vi.fn(),
}))
vi.mock('../../src/api/chat', () => ({ startChatStream: startChatStreamMock }))

/** 构造一个一次吐出若干 SSE 分块的响应 */
function buildSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** 构造一个"悬停"的流：测试期间手动控制 emit/end */
function buildPendingStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  const encoder = new TextEncoder()
  return {
    response: new Response(stream, { status: 200 }),
    emit(chunk: string) {
      controller.enqueue(encoder.encode(chunk))
    },
    end() {
      controller.close()
    },
  }
}

const event = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`
const doneEvent = 'data: [DONE]\n\n'

/** 让多层异步（fetch 读取 + SSE 解析）跑完 */
async function flushAll() {
  for (let i = 0; i < 10; i++) {
    await flushPromises()
    await Promise.resolve()
  }
}

async function sendByEnter(wrapper: VueWrapper, text: string) {
  const textarea = wrapper.find('textarea')
  await textarea.setValue(text)
  await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
  await flushAll()
}

describe('Chat 视图', () => {
  beforeEach(() => {
    startChatStreamMock.mockReset()
    // chat.vue 内 useUserStore() 依赖一个激活的 pinia 实例
    setActivePinia(createPinia())
  })

  it('空白输入不发起请求', async () => {
    const wrapper = mount(Chat)
    await sendByEnter(wrapper, '   ')
    expect(startChatStreamMock).not.toHaveBeenCalled()
    expect(wrapper.findAll('.message-row')).toHaveLength(0)
  })

  it('流式响应逐字渲染到一条 assistant 消息并正确收尾', async () => {
    startChatStreamMock.mockResolvedValue(
      buildSseResponse([event('你'), event('好'), doneEvent]),
    )
    const wrapper = mount(Chat)
    await sendByEnter(wrapper, 'hi')

    // 用户消息
    expect(wrapper.find('.message-row.user .message-bubble').text()).toBe('hi')
    // 只生成一条 assistant 消息，内容为流式拼接结果
    const assistantRows = wrapper.findAll('.message-row.assistant')
    expect(assistantRows).toHaveLength(1)
    expect(assistantRows[0].find('.message-bubble').text()).toBe('你好')
    // 请求体：首轮只有当前这条用户消息
    expect(startChatStreamMock.mock.calls[0][0]).toEqual([
      { role: 'user', content: 'hi' },
    ])
    // 输入已清空、"正在思考"动画消失
    expect(
      (wrapper.find('textarea').element as HTMLTextAreaElement).value,
    ).toBe('')
    expect(wrapper.find('.typing').exists()).toBe(false)
    // loading 已复位：重新输入内容后发送按钮恢复可用
    await wrapper.find('textarea').setValue('x')
    await flushAll()
    expect(wrapper.find('.send-button').attributes('disabled')).toBeUndefined()
  })

  it('多轮对话时每次只把最新一条用户消息作为请求体', async () => {
    startChatStreamMock
      .mockResolvedValueOnce(buildSseResponse([event('你好'), doneEvent]))
      .mockResolvedValueOnce(buildSseResponse([event('再见'), doneEvent]))
    const wrapper = mount(Chat)
    await sendByEnter(wrapper, 'hi')
    await sendByEnter(wrapper, '再来一个')

    expect(startChatStreamMock).toHaveBeenCalledTimes(2)
    expect(startChatStreamMock.mock.calls[0][0]).toEqual([
      { role: 'user', content: 'hi' },
    ])
    expect(startChatStreamMock.mock.calls[1][0]).toEqual([
      { role: 'user', content: '再来一个' },
    ])
  })

  it('首字到达前显示"正在思考"，结束后消失', async () => {
    const { response, emit, end } = buildPendingStream()
    startChatStreamMock.mockResolvedValue(response)
    const wrapper = mount(Chat)

    const textarea = wrapper.find('textarea')
    await textarea.setValue('hi')
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
    // 等组件走到 reader.read() 挂起
    for (let i = 0; i < 6; i++) {
      await flushPromises()
      await Promise.resolve()
    }
    expect(wrapper.find('.typing').exists()).toBe(true)

    emit(event('早'))
    end()
    await flushAll()

    expect(wrapper.find('.typing').exists()).toBe(false)
    expect(
      wrapper.find('.message-row.assistant .message-bubble').text(),
    ).toBe('早')
  })

  it('点击停止按钮会取消请求和流读取，并保留已收到的内容', async () => {
    const { response, emit } = buildPendingStream()
    startChatStreamMock.mockResolvedValue(response)
    const wrapper = mount(Chat)

    await wrapper.find('textarea').setValue('hi')
    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
    await flushAll()
    emit(event('已收到'))
    await flushAll()

    expect(wrapper.find('.stop-button').exists()).toBe(true)
    await wrapper.find('.stop-button').trigger('click')
    await flushAll()

    expect(startChatStreamMock.mock.calls[0][1].aborted).toBe(true)
    expect(wrapper.find('.stop-button').exists()).toBe(false)
    expect(wrapper.find('.message-row.assistant .message-bubble').text()).toBe(
      '已收到',
    )
    expect(
      wrapper.find('.message-row.assistant .message-bubble').text(),
    ).not.toContain('抱歉')
  })

  it('接口返回非 2xx 时给出兜底提示并复位状态', async () => {
    startChatStreamMock.mockResolvedValue(
      new Response(null, { status: 503 }) as unknown as Response,
    )
    const wrapper = mount(Chat)
    await sendByEnter(wrapper, 'hi')

    expect(
      wrapper.find('.message-row.assistant .message-bubble').text(),
    ).toContain('抱歉')
    expect(wrapper.find('.typing').exists()).toBe(false)
    // loading 已复位：重新输入内容后发送按钮恢复可用
    await wrapper.find('textarea').setValue('x')
    await flushAll()
    expect(wrapper.find('.send-button').attributes('disabled')).toBeUndefined()
  })
})
