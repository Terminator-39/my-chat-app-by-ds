import http from './http'

export interface LoginRequest {
  username: string
  password: string
}

interface LoginResponse {
  code?: unknown
  message?: unknown
  data?: unknown
}

function getToken(response: LoginResponse): string | undefined {
  const data = typeof response.data === 'object' && response.data !== null ? response.data as Record<string, unknown> : undefined
  for (const value of [response.data, data?.access_token, data?.token]) {
    if (typeof value === 'string' && value.length > 0) return value
  }
}

export async function login(payload: LoginRequest): Promise<string> {
  const { data } = await http.get<LoginResponse>('/api/user/login', { params: payload })
  if (data.code !== 200) {
    throw new Error(typeof data.message === 'string' ? data.message : '登录失败')
  }

  const token = getToken(data)
  if (!token) throw new Error('登录响应缺少有效 token')
  return token
}
