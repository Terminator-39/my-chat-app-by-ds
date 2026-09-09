/*
 * @Author: wlong
 * @Date: 2026-09-07 17:54:59
 * @LastEditTime: 2026-09-09 13:05:01
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/src/api/user.ts
 */
import http from './http'

export interface LoginRequest {
  username: string
  password: string
}

interface LoginResponse {
  code: number | string
  message: string
  data?: {
    token?: string
    userInfo?: {
      id?: number
      username?: string
      sessionId?: string
    }
  }
}

// function getToken(response: LoginResponse): string | undefined {
//   const data = typeof response.data === 'object' && response.data !== null ? response.data as Record<string, unknown> : undefined
//   for (const value of [response.data, data?.access_token, data?.token]) {
//     if (typeof value === 'string' && value.length > 0) return value
//   }
// }

export async function login(payload: LoginRequest): Promise<LoginResponse> {
  const { data: res } = await http.get<LoginResponse>('/api/user/login', { params: payload })
  if (res?.code !== 200) {
    throw new Error(typeof res.message === 'string' ? res.message : '登录失败')
  }

  const token = res.data?.token
  if (!token) throw new Error('登录响应缺少有效 token')
  const sessionId = 'sessionId_' + res.data?.userInfo?.id
  if (!res.data!.userInfo) res.data!.userInfo = {}
  res.data!.userInfo.sessionId = sessionId
  return res
}
