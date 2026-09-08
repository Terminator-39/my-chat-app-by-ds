/**
 * 测试环境兜底：补齐 jsdom 缺失但被测代码依赖的全局能力
 */

// jsdom 的 crypto 可能缺少 randomUUID（组件里用于生成 sessionId）
const maybeCrypto = globalThis.crypto as Crypto & {
  randomUUID?: () => string
}
if (!maybeCrypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: Object.assign({}, maybeCrypto, {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    }),
  })
}

// Element Plus 内部可能用到 ResizeObserver / matchMedia，jsdom 未实现
if (!globalThis.ResizeObserver) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(globalThis as { ResizeObserver: unknown }).ResizeObserver =
    ResizeObserverStub
}

if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// 若测试环境覆盖掉了 Node 的 Web Streams / fetch 相关全局，则补回（被测代码流式解析依赖）
import { Response as NodeResponse, ReadableStream as NodeReadableStream } from 'node:stream/web'
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'

const g = globalThis as unknown as Record<string, unknown>
const nodeGlobals: Record<string, unknown> = {
  Response: NodeResponse,
  ReadableStream: NodeReadableStream,
  TextDecoder: NodeTextDecoder,
  TextEncoder: NodeTextEncoder,
}
for (const [key, value] of Object.entries(nodeGlobals)) {
  if (typeof g[key] === 'undefined') {
    Object.defineProperty(g, key, { value, writable: true, configurable: true })
  }
}
