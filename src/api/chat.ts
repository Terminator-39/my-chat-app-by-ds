/*
 * @Author: wlong
 * @Date: 2026-09-07 18:44:22
 * @LastEditTime: 2026-09-10 16:54:06
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/src/api/chat.ts
 */
import http from './http'

export interface ChatRequest {
  prompt: string
  session_id: string
  stream?: boolean
}

export interface ChatResponse {
  session_id: string
  text: string
}
interface MessageItem {
  role: "user" | "assistant";
  content: string;
  sessionId?: string;
}

export interface ConversationSummary {
  id: string
  title: string
  updated_at: number
}

export interface ConversationDetail extends ConversationSummary {
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

/**
 * 读取当前登录令牌并生成聊天接口请求头。
 * @returns 包含 Authorization 的请求头；未登录时返回空对象
 */
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * 读取聊天相关 JSON 接口，并兼容后端裸数据和统一响应包装格式。
 * @param path 请求路径
 * @returns 解包后的接口数据
 */
async function getChatData<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: authHeaders() })
  if (!response.ok) throw new Error(`请求失败（${response.status}）`)
  const body = (await response.json()) as T | { data?: T; code?: number }
  // 后端部分接口直接返回数据，统一响应处理器则返回 { code, message, data }。
  // 在 API 层统一解包，避免页面业务逻辑同时判断两种返回结构。
  if (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    'data' in body
  ) {
    return body.data as T
  }
  return body as T
}

/**
 * 获取当前用户的会话摘要列表。
 * @returns 按最近使用时间排列的会话摘要
 */
export function getConversations(): Promise<ConversationSummary[]> {
  return getChatData<ConversationSummary[]>('/api/chat/deepseek/conversations')
}

/**
 * 获取指定会话的完整历史消息。
 * @param sessionId 会话 ID
 * @returns 会话元数据和历史消息
 */
export function getConversation(sessionId: string): Promise<ConversationDetail> {
  return getChatData<ConversationDetail>(
    `/api/chat/deepseek/conversations/${encodeURIComponent(sessionId)}`,
  )
}

/**
 * 调用非流式聊天接口。
 * @param payload 非流式聊天请求参数
 * @returns 模型生成的完整文本
 */
export async function startChat(payload: ChatRequest): Promise<ChatResponse> {
  const { data } = await http.post<ChatResponse>('/api/chat/deepseek/start_chat', payload)
  return data
}

/**
 * 发起流式聊天请求。
 * @param payload 当前轮用户消息；历史上下文由后端根据 sessionId 组装
 * @param signal 用于取消 fetch 请求
 * @param options requestId 用于断点续传，lastEventId 用于声明已接收的 SSE 事件
 * @returns 原始 Response，交由 SSE 解析器持续读取
 */
export async function startChatStream(
  payload: MessageItem[],
  signal?: AbortSignal,
  options?: { requestId: string; lastEventId?: number },
) {
  const params = new URLSearchParams()
  if (options) {
    params.set('requestId', options.requestId)
    if (payload[0]?.sessionId) params.set('sessionId', payload[0].sessionId)
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders(),
  }
  if (options?.lastEventId) headers['Last-Event-ID'] = String(options.lastEventId)

  const query = params.toString()
  const res = await fetch(`/api/chat/deepseek/stream_chat${query ? `?${query}` : ''}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal,
  })
  return res
}
