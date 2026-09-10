<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getConversation,
  getConversations,
  startChatStream,
  type ConversationDetail,
} from '../api/chat'
import { ChatStreamServerError, readChatStream } from '../utils/chat-stream'
import { renderMarkdown } from '../utils/markdown'

interface Message {
  role: 'user' | 'assistant'
  content: string
  time: string
  sessionId?: string
  renderedContent?: string
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  loaded: boolean
}

const suggestions = [
  '帮我写一份产品需求文档',
  '把这段话翻译成英文',
  '分析一下我的工作计划',
]
const initialConversationId = crypto.randomUUID()
const conversations = ref<Conversation[]>([
  { id: initialConversationId, title: '新的对话', messages: [], loaded: true },
])
const activeConversationId = ref<string>(initialConversationId)
const messages = ref<Message[]>(conversations.value[0].messages)
const input = ref('')
const loading = ref(false)
// 是否在等待模型输出首个字符：为 true 时显示"正在思考"动画，首字到达后隐藏
const typing = ref(false)
// stopping 单独于 loading：取消请求需要等待 reader/fetch 收尾，期间按钮必须进入“停止中”状态。
const stopping = ref(false)
const loadingHistory = ref(false)
const conversation = ref('新的对话')
// 登录用户 ID 只用于鉴权；每个独立聊天窗口使用自己的会话 ID，避免多个对话共享历史。
const chatSessionId = ref<string>(initialConversationId)
const messageList = ref<HTMLElement>()
const abortController = ref<AbortController | null>(null)
let markdownFrame: number | null = null

/**
 * 渲染当前会话最新一条 assistant 消息的 Markdown 内容。
 * 流式 token 到达时使用该方法，避免每次重新处理整段历史。
 */
async function renderAssistantMarkdown() {
  const assistant = [...messages.value]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (!assistant) return
  const content = assistant.content
  const renderedContent = await renderMarkdown(content)
  // Shiki 是异步的；旧一帧晚到时不能覆盖更新后的内容。
  if (assistant.content === content) assistant.renderedContent = renderedContent
}

/**
 * 渲染当前会话中的全部 assistant 历史消息。
 * 会话从后端加载或切换时使用，确保历史消息也拥有 renderedContent。
 */
async function renderAllAssistantMarkdown() {
  const assistants = messages.value.filter((message) => message.role === 'assistant')
  await Promise.all(
    assistants.map(async (assistant) => {
      const content = assistant.content
      const renderedContent = await renderMarkdown(content)
      // 历史加载期间如果会话发生切换，不能把旧会话的结果写入当前消息对象。
      if (assistant.content === content) assistant.renderedContent = renderedContent
    }),
  )
}

/**
 * 合并同一帧内到达的多个 token，减少 Markdown 解析次数。
 */
function scheduleAssistantMarkdown() {
  if (markdownFrame !== null) return
  const schedule =
    typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (callback: FrameRequestCallback) => window.setTimeout(callback, 0)
  markdownFrame = schedule(() => {
    markdownFrame = null
    void renderAssistantMarkdown()
  })
}

/**
 * 返回当前时间，用于消息列表显示。
 */
const now = () =>
  new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
/**
 * 将当前消息列表滚动到最底部，保证流式输出始终可见。
 */
async function scrollToBottom() {
  await nextTick()
  if (messageList.value)
    messageList.value.scrollTop = messageList.value.scrollHeight
}

/**
 * 切换会话后定位到该会话最后一条用户 prompt。
 */
async function scrollToLastUserPrompt(): Promise<void> {
  await nextTick()
  const list = messageList.value
  if (!list) return
  const prompts = list.querySelectorAll<HTMLElement>(
    '[data-message-role="user"]',
  )
  const lastPrompt = prompts[prompts.length - 1]
  // 直接设置滚动容器位置，兼容自定义滚动容器和测试环境中的 jsdom。
  list.scrollTop = lastPrompt ? Math.max(lastPrompt.offsetTop - 50, 0) : 0
}

/**
 * 将当前响应式消息数组和标题同步回活动会话对象。
 */
function saveActiveConversation() {
  const active = conversations.value.find(
    (item) => item.id === activeConversationId.value,
  )
  if (!active) return
  active.messages = messages.value
  active.title = conversation.value
}

/**
 * 将后端历史消息转换为前端消息模型。
 * @param detail 后端返回的会话详情
 * @returns 带显示时间和会话 ID 的前端消息数组
 */
function toMessages(detail: ConversationDetail): Message[] {
  return detail.messages.map((message) => ({
    role: message.role,
    content: message.content,
    time: now(),
    sessionId: detail.id,
  }))
}

/**
 * 初始化加载当前用户的最近会话，并加载最新会话的完整历史。
 * 接口失败时保留本地空会话，避免聊天页面无法继续使用。
 */
async function loadConversations() {
  try {
    const summaries = await getConversations()
    if (!summaries.length) return

    const loaded = summaries.map<Conversation>((item) => ({
      id: item.id,
      title: item.title,
      messages: [],
      loaded: false,
    }))
    conversations.value = loaded
    const latest = loaded[0]
    activeConversationId.value = latest.id
    chatSessionId.value = latest.id
    conversation.value = latest.title
    loadingHistory.value = true
    const detail = await getConversation(latest.id)
    latest.messages = toMessages(detail)
    latest.loaded = true
    messages.value = latest.messages
    await renderAllAssistantMarkdown()
  } catch {
    // 未登录或接口暂不可用时保留本地新会话，不影响当前页面继续发起聊天。
  } finally {
    loadingHistory.value = false
  }
}

/**
 * 切换当前会话；未加载过的会话先从后端按需读取历史。
 * @param id 目标会话 ID
 */
async function switchConversation(id: string) {
  // debugger
  if (loading.value || loadingHistory.value || id === activeConversationId.value) return
  const target = conversations.value.find((item) => item.id === id)
  target!.loaded = false
  if (!target) return

  if (!target.loaded) {
    loadingHistory.value = true
    try {
      target.messages = toMessages(await getConversation(target.id))
      target.loaded = true
      messages.value = target.messages
      await renderAllAssistantMarkdown()
    } catch {
      ElMessage.error('加载会话失败，请稍后再试')
      return
    } finally {
      loadingHistory.value = false
    }
  }

  // 生成期间禁止切换；否则流式 token 可能追加到新会话中。
  saveActiveConversation()
  activeConversationId.value = target.id
  chatSessionId.value = target.id
  conversation.value = target.title
  messages.value = target.messages
  await scrollToLastUserPrompt()
}

/**
 * 创建一个可被 AbortSignal 中断的重连退避等待。
 * @param delay 等待毫秒数
 * @param signal 当前生成请求的取消信号
 */
function waitForReconnect(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }

    // 将退避计时器与 AbortSignal 绑定，用户点击停止后不再无意义地等待下一次重连。
    let settled = false
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }
    const timer = window.setTimeout(finish, delay)
    const onAbort = () => {
      window.clearTimeout(timer)
      finish()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 发送一轮用户消息并消费 assistant 的 SSE 增量响应。
 * 断线时复用同一个 requestId 和最后事件 ID进行重连。
 * @param content 待发送的用户 prompt
 */
async function sendMessage(content = input.value) {
  const text = content.trim()
  if (!text || loading.value) return
  // sessionId 是当前对话的 ID，不再复用登录接口返回的用户级 ID；同一对话的多轮消息
  // 复用它，后端才能从同一份历史中组装上下文。
  const sessionId = chatSessionId.value
  // 本地列表用完整消息（含展示字段 time/sessionId）
  const message: Message = {
    role: 'user',
    content: text,
    time: now(),
    sessionId,
  }
  messages.value.push(message)
  input.value = ''
  if (conversation.value === '新的对话') {
    conversation.value = text.slice(0, 22)
    const active = conversations.value.find(
      (item) => item.id === activeConversationId.value,
    )
    if (active) active.title = conversation.value
  }
  loading.value = true
  typing.value = true
  stopping.value = false
  await scrollToBottom()
  const controller = new AbortController()
  abortController.value = controller
  try {
    // todo ----- stream ⬇
    // 只把最新这条用户消息发给模型，body 仅含 role/content；历史会话由服务端自行维护
    const payload = [
      { role: message.role, content: message.content, sessionId },
    ]
    // 占位一条 assistant 消息，只 push 一次，不能放进循环
    messages.value.push({
      role: 'assistant',
      content: '',
      time: now(),
      sessionId,
    })
    await scrollToBottom()
    const requestId = crypto.randomUUID()
    let lastEventId = 0
    let reconnectCount = 0
    const maxReconnects = 3

    while (true) {
      try {
        const response = await startChatStream(payload, controller.signal, {
          requestId,
          lastEventId,
        })
        if (!response.ok)
          throw new ChatStreamServerError(`请求失败（${response.status}）`)

        const result = await readChatStream(response, {
          signal: controller.signal,
          onEvent: (delta) => {
            // 首个字到达后隐藏"正在思考"动画，避免与输出内容重叠。
            typing.value = false
            // 只追加当前事件；重连时后端从 Last-Event-ID 之后重放，不会重复内容。
            const assistant = messages.value[messages.value.length - 1]
            assistant.content += delta
            scheduleAssistantMarkdown()
          },
        })
        lastEventId = result.lastEventId
        if (result.completed) break
      } catch (error) {
        if (controller.signal.aborted) throw error
        // 服务端已明确返回业务错误时不要重试，否则会反复重放同一个错误事件。
        if (error instanceof ChatStreamServerError) throw error
        if (reconnectCount >= maxReconnects) throw error
      }

      if (controller.signal.aborted) return
      reconnectCount += 1
      // 短暂网络抖动时复用同一个 requestId，从 Redis 继续消费，而不是重新生成。
      await waitForReconnect(500 * reconnectCount, controller.signal)
    }
    // input.value = ''

    // todo ----- stream ⬆
    // const response = await startChat({
    //   prompt: text,
    //   session_id: sessionId.value,
    //   stream: false,
    // })
    // sessionId.value = response.session_id
    // messages.value.push({
    //   role: 'assistant',
    //   content: response.text,
    //   time: now(),
    // })
  } catch (error) {
    typing.value = false
    if (
      controller.signal.aborted ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      return
    }
    ElMessage.error(
      error instanceof Error ? error.message : '连接服务失败，请稍后再试',
    )
    const lastMessage = messages.value[messages.value.length - 1]
    if (lastMessage?.role === 'assistant' && !lastMessage.content) {
      lastMessage.content = '抱歉，我暂时无法连接服务。请检查后端是否已启动。'
    } else {
      messages.value.push({
        role: 'assistant',
        content: '抱歉，我暂时无法连接服务。请检查后端是否已启动。',
        time: now(),
        sessionId,
      })
    }
  } finally {
    await renderAssistantMarkdown()
    if (abortController.value === controller) abortController.value = null
    loading.value = false
    typing.value = false
    stopping.value = false
    await scrollToBottom()
  }
}

/**
 * 取消当前生成请求，保留已经收到的 assistant 内容。
 */
async function stopGeneration() {
  const controller = abortController.value
  if (!controller) return
  // 先更新界面，再终止底层请求；这样慢网络下用户能立即知道点击已生效。
  stopping.value = true
  controller.abort()
}

/**
 * 创建并切换到新的空会话；生成期间不允许清空正在写入的会话。
 */
function resetChat() {
  if (loading.value) return
  saveActiveConversation()
  const nextConversation: Conversation = {
    id: crypto.randomUUID(),
    title: '新的对话',
    messages: [],
    loaded: true,
  }
  // unshift 保证新建的会话始终出现在“最近对话”列表顶部。
  conversations.value.unshift(nextConversation)
  activeConversationId.value = nextConversation.id
  chatSessionId.value = nextConversation.id
  messages.value = nextConversation.messages
  input.value = ''
  conversation.value = '新的对话'
}

onBeforeUnmount(() => {
  void stopGeneration()
  if (markdownFrame !== null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(markdownFrame)
  }
})

onMounted(() => {
  void loadConversations()
})
/**
 * 处理输入框快捷键：Enter 发送，Shift+Enter 换行。
 */
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <main class="chat-page">
    <aside class="chat-sidebar">
      <div class="brand">
        <span class="brand-mark">✦</span><span>Neura</span>
      </div>
      <button
        class="new-chat"
        type="button"
        :disabled="loading || loadingHistory"
        @click="resetChat"
      >
        <span>＋</span> 新建对话
      </button>
      <div class="sidebar-section-label">最近对话</div>
      <button
        v-for="item in conversations"
        :key="item.id"
        class="history-item"
        :class="{ active: item.id === activeConversationId }"
        type="button"
        :disabled="loading || loadingHistory"
        @click="switchConversation(item.id)"
      >
        <span class="history-dot">◌</span><span>{{ item.title }}</span>
      </button>
      <div class="sidebar-footer">
        <div class="profile-avatar">W</div>
        <div><strong>欢迎回来</strong><small>个人空间</small></div>
        <span class="more">···</span>
      </div>
    </aside>
    <section class="chat-shell">
      <header class="chat-header">
        <div>
          <div class="eyebrow">AI CONVERSATION</div>
          <h1>{{ conversation }}</h1>
        </div>
        <div class="header-actions">
          <span class="model-pill"><i></i> DeepSeek</span
          ><button class="icon-button" type="button" aria-label="更多操作">
            •••
          </button>
        </div>
      </header>
      <div ref="messageList" class="message-list">
        <div v-if="loadingHistory" class="history-loading">加载对话中…</div>
        <div v-else-if="!messages.length" class="empty-state">
          <div class="welcome-orb"><span>✦</span></div>
          <div class="welcome-kicker">GOOD TO SEE YOU</div>
          <h2>今天想和我聊点什么？</h2>
          <p>我可以帮你思考、创作、分析，把每个想法变成清晰的下一步。</p>
          <div class="suggestions">
            <button
              v-for="suggestion in suggestions"
              :key="suggestion"
              type="button"
              @click="sendMessage(suggestion)"
            >
              {{ suggestion }} <span>↗</span>
            </button>
          </div>
        </div>
        <div v-else class="conversation">
          <div
            v-for="(message, index) in messages"
            :key="`${message.time}-${index}`"
            class="message-row"
            :class="message.role"
            :data-message-role="message.role"
          >
            <div v-if="message.role === 'assistant'" class="message-avatar">
              ✦
            </div>
            <div class="message-content">
              <div class="message-meta">
                {{ message.role === 'assistant' ? 'Neura' : '你' }} ·
                {{ message.time }}
              </div>
              <div
                v-if="message.role === 'assistant'"
                class="message-bubble markdown-body"
                v-html="message.renderedContent ?? ''"
              ></div>
              <div v-else class="message-bubble">{{ message.content }}</div>
            </div>
            <div v-if="message.role === 'user'" class="user-avatar">W</div>
          </div>
          <div v-if="typing" class="message-row assistant">
            <div class="message-avatar">✦</div>
            <div class="message-content">
              <div class="message-meta">Neura · 正在思考</div>
              <div class="message-bubble typing">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <footer class="composer-wrap">
        <div class="composer">
          <textarea
            v-model="input"
            rows="1"
            placeholder="输入你的问题，按 Enter 发送"
            @keydown="handleKeydown"
          ></textarea>
          <div class="composer-tools">
            <span>Shift + Enter 换行</span>
            <button
              v-if="loading"
              class="send-button stop-button"
              type="button"
              :disabled="stopping"
              :aria-label="stopping ? '正在停止' : '停止生成'"
              :title="stopping ? '正在停止' : '停止生成'"
              @click="stopGeneration"
            >
              {{ stopping ? '…' : '■' }}
            </button>
            <button
              v-else
              class="send-button"
              type="button"
              :disabled="loading || !input.trim()"
              aria-label="发送"
              @click="sendMessage()"
            >
              ↑
            </button>
          </div>
        </div>
        <p class="disclaimer">
          Neura 可能会产生错误信息，请对重要内容进行核实。
        </p>
      </footer>
    </section>
  </main>
</template>

<style scoped>
:global(#app) {
  height: 100svh;
  min-height: 0;
  overflow: hidden;
}
.chat-page {
  --ink: #f8f7ff;
  --muted: #9490a8;
  --line: rgba(255, 255, 255, 0.09);
  display: flex;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--ink);
  background: #0b0b13;
}
.chat-sidebar {
  display: flex;
  width: 248px;
  flex: 0 0 248px;
  flex-direction: column;
  padding: 30px 18px 20px;
  box-sizing: border-box;
  border-right: 1px solid var(--line);
  background: rgba(18, 17, 30, 0.76);
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 0 12px 42px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.brand-mark {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 10px;
  color: #16111f;
  background: linear-gradient(135deg, #d5b4ff, #8b65f5);
  box-shadow: 0 0 22px rgba(161, 112, 255, 0.5);
}
.new-chat,
.history-item {
  border: 1px solid var(--line);
  color: #eeebf8;
  background: transparent;
}
.new-chat:disabled,
.history-item:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.new-chat {
  display: flex;
  gap: 9px;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  border-radius: 11px;
  font: inherit;
  cursor: pointer;
}
.new-chat span {
  color: #b694ff;
  font-size: 19px;
}
.sidebar-section-label {
  margin: 34px 12px 10px;
  color: #69657b;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1.5px;
}
.history-item {
  display: flex;
  gap: 10px;
  align-items: center;
  overflow: hidden;
  width: 100%;
  padding: 11px 12px;
  border-color: transparent;
  border-radius: 10px;
  color: #b5b0c8;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}
.history-item.active {
  color: #f4efff;
  background: rgba(159, 121, 241, 0.14);
}
.history-dot {
  color: #a378f4;
}
.history-loading {
  padding: 24px;
  color: #9490a8;
  font-size: 12px;
  text-align: center;
}
.sidebar-footer {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: auto;
  padding: 16px 10px 0;
  border-top: 1px solid var(--line);
  color: #ddd8e8;
  font-size: 12px;
}
.profile-avatar,
.user-avatar {
  display: grid;
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 10px;
  color: #1a1426;
  font-size: 12px;
  font-weight: 700;
  background: #c3a5f7;
}
.sidebar-footer small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
}
.more {
  margin-left: auto;
  color: #777289;
  letter-spacing: 2px;
}
.chat-shell {
  display: flex;
  width: min(100%, 1060px);
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  margin: 0 auto;
  overflow: hidden;
  background: radial-gradient(
    circle at 50% -15%,
    rgba(93, 62, 156, 0.2),
    transparent 42%
  );
}
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 27px clamp(24px, 5vw, 70px) 23px;
  border-bottom: 1px solid var(--line);
}
.eyebrow,
.welcome-kicker {
  color: #8973bf;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 2px;
}
.chat-header h1 {
  margin: 5px 0 0;
  color: #f4f0fc;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0;
}
.header-actions {
  display: flex;
  gap: 15px;
  align-items: center;
}
.model-pill {
  padding: 7px 11px;
  border: 1px solid var(--line);
  border-radius: 20px;
  color: #b7aecb;
  font-size: 11px;
}
.model-pill i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: #7ee0a7;
  box-shadow: 0 0 9px #7ee0a7;
}
.icon-button {
  border: 0;
  color: #8b849c;
  background: transparent;
  letter-spacing: 2px;
  cursor: pointer;
}
.message-list {
  overflow: auto;
  width: min(100%, 820px);
  min-height: 0;
  flex: 1;
  margin: 0 auto;
  padding: 28px 24px;
  box-sizing: border-box;
}
.empty-state {
  display: flex;
  min-height: 100%;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-bottom: 8vh;
  text-align: center;
}
.welcome-orb {
  display: grid;
  width: 66px;
  height: 66px;
  place-items: center;
  margin-bottom: 22px;
  border: 1px solid rgba(205, 178, 255, 0.35);
  border-radius: 22px;
  color: #e7d9ff;
  font-size: 28px;
  background: linear-gradient(
    135deg,
    rgba(209, 174, 255, 0.25),
    rgba(104, 76, 176, 0.18)
  );
  box-shadow: 0 0 60px rgba(142, 98, 228, 0.28);
}
.empty-state h2 {
  margin: 12px 0 8px;
  color: #f6f2ff;
  font-size: clamp(25px, 4vw, 34px);
  font-weight: 500;
  letter-spacing: -1px;
}
.empty-state p {
  max-width: 430px;
  color: #918b9f;
  font-size: 13px;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 9px;
  margin-top: 28px;
}
.suggestions button {
  padding: 10px 13px;
  border: 1px solid var(--line);
  border-radius: 10px;
  color: #bbb3ca;
  font: inherit;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition:
    border-color 0.2s,
    background 0.2s;
}
.suggestions button:hover {
  border-color: #8f70ce;
  background: rgba(159, 121, 241, 0.12);
}
.suggestions span {
  margin-left: 7px;
  color: #a17de7;
}
.conversation {
  display: flex;
  flex-direction: column;
  gap: 26px;
  padding-bottom: 25px;
}
.message-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.message-row.user {
  justify-content: flex-end;
}
.message-content {
  max-width: min(76%, 620px);
  text-align: left;
}
.message-meta {
  margin: 2px 0 7px;
  color: #777187;
  font-size: 10px;
}
.message-row.user .message-meta {
  text-align: right;
}
.message-bubble {
  padding: 13px 16px;
  border: 1px solid var(--line);
  border-radius: 4px 15px 15px;
  color: #d9d4e2;
  font-size: 13px;
  line-height: 1.75;
  white-space: pre-wrap;
  background: rgba(255, 255, 255, 0.045);
}
.markdown-body :deep(p) {
  margin: 0;
}
.markdown-body {
  line-height: 1.25;
}
.markdown-body :deep(p + p) {
  margin-top: 0.45em;
}
.markdown-body :deep(pre) {
  overflow-x: auto;
  margin: 10px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
}
.markdown-body :deep(pre code) {
  display: block;
  padding: 0;
  color: inherit;
  background: transparent;
  white-space: pre;
}
.markdown-body :deep(a) {
  color: #c5a7ff;
}
.message-row.user .message-bubble {
  border: 0;
  border-radius: 15px 4px 15px 15px;
  color: #21172e;
  background: linear-gradient(135deg, #d1b7fa, #a886eb);
}
.message-avatar {
  display: grid;
  flex: 0 0 auto;
  width: 29px;
  height: 29px;
  place-items: center;
  border: 1px solid rgba(179, 139, 249, 0.35);
  border-radius: 10px;
  color: #d1b9fb;
  font-size: 13px;
  background: rgba(150, 111, 232, 0.15);
}
.typing {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 44px;
  box-sizing: border-box;
}
.typing span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #9f80df;
  animation: pulse 1.2s infinite ease-in-out;
}
.typing span:nth-child(2) {
  animation-delay: 0.15s;
}
.typing span:nth-child(3) {
  animation-delay: 0.3s;
}
@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}
.composer-wrap {
  width: min(100%, 820px);
  padding: 0 24px 23px;
  margin: 0 auto;
  box-sizing: border-box;
}
.composer {
  padding: 10px 11px 10px 17px;
  border: 1px solid rgba(178, 145, 242, 0.3);
  border-radius: 16px;
  background: rgba(28, 24, 43, 0.85);
  box-shadow:
    0 12px 45px rgba(0, 0, 0, 0.25),
    inset 0 1px rgba(255, 255, 255, 0.05);
}
.composer textarea {
  display: block;
  overflow: auto;
  width: 100%;
  min-height: 26px;
  max-height: 110px;
  padding: 2px 0;
  border: 0;
  outline: 0;
  resize: none;
  color: #f2edf8;
  font: inherit;
  font-size: 13px;
  background: transparent;
}
.composer textarea::placeholder {
  color: #777188;
}
.composer-tools {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 13px;
  color: #696378;
  font-size: 10px;
}
.send-button {
  display: grid;
  width: 29px;
  height: 29px;
  place-items: center;
  border: 0;
  border-radius: 9px;
  color: #241831;
  font-size: 20px;
  background: #c2a3f4;
  cursor: pointer;
}
.send-button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}
.disclaimer {
  margin-top: 10px;
  color: #5f5a6d;
  text-align: center;
  font-size: 10px;
}
@media (max-width: 700px) {
  .chat-sidebar {
    display: none;
  }
  .chat-header {
    padding-inline: 20px;
  }
  .header-actions .model-pill {
    display: none;
  }
  .message-list,
  .composer-wrap {
    padding-inline: 16px;
  }
  .message-content {
    max-width: 84%;
  }
  .suggestions button {
    width: 100%;
  }
}
</style>
