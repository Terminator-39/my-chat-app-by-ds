import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '../../src/api/user'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('../../src/api/http', () => ({ default: { get: getMock } }))

describe('login', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('登录成功返回完整响应，并按 userInfo.id 注入 sessionId', async () => {
    getMock.mockResolvedValue({
      data: {
        code: 200,
        data: { token: 'tok-1', userInfo: { id: 7, username: 'u' } },
      },
    })
    await expect(login({ username: 'u', password: 'p' })).resolves.toEqual({
      code: 200,
      data: {
        token: 'tok-1',
        userInfo: { id: 7, username: 'u', sessionId: 'sessionId_7' },
      },
    })
    expect(getMock).toHaveBeenCalledWith('/api/user/login', {
      params: { username: 'u', password: 'p' },
    })
  })

  it('响应缺少 userInfo 时兜底创建并注入 sessionId', async () => {
    getMock.mockResolvedValue({ data: { code: 200, data: { token: 'tok-2' } } })
    await expect(login({ username: 'u', password: 'p' })).resolves.toEqual({
      code: 200,
      data: { token: 'tok-2', userInfo: { sessionId: 'sessionId_undefined' } },
    })
  })

  it('业务失败（code!==200）时抛出后端 message', async () => {
    getMock.mockResolvedValue({ data: { code: 401, message: '密码错误' } })
    await expect(
      login({ username: 'u', password: 'wrong' }),
    ).rejects.toThrow('密码错误')
  })

  it('响应缺少有效 token 时抛错', async () => {
    getMock.mockResolvedValue({ data: { code: 200, data: {} } })
    await expect(
      login({ username: 'u', password: 'p' }),
    ).rejects.toThrow('登录响应缺少有效 token')
  })
})
