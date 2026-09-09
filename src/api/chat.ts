/*
 * @Author: wlong
 * @Date: 2026-09-07 18:44:22
 * @LastEditTime: 2026-09-07 21:17:24
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

export async function startChat(payload: ChatRequest): Promise<ChatResponse> {
  const { data } = await http.post<ChatResponse>('/api/chat/deepseek/start_chat', payload)
  return data
}

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
  const token = localStorage.getItem('access_token')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
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
