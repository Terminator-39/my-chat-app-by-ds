import { beforeEach, describe, expect, it, vi } from 'vitest'
import { login } from '../../src/api/user'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))
vi.mock('../../src/api/http', () => ({ default: { get: getMock } }))

describe('login', () => {
  beforeEach(() => {
    getMock.mockReset()
  })

  it('从 data.access_token 中提取 token 并返回', async () => {
    getMock.mockResolvedValue({
      data: { code: 200, data: { access_token: 'tok-1' } },
    })
    await expect(login({ username: 'u', password: 'p' })).resolves.toBe(
      'tok-1',
    )
    expect(getMock).toHaveBeenCalledWith('/api/user/login', {
      params: { username: 'u', password: 'p' },
    })
  })

  it('兼容 data.token 的返回结构', async () => {
    getMock.mockResolvedValue({
      data: { code: 200, data: { token: 'tok-2' } },
    })
    await expect(login({ username: 'u', password: 'p' })).resolves.toBe(
      'tok-2',
    )
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
