import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/utils/markdown'

describe('renderMarkdown', () => {
  it('渲染 GFM Markdown', async () => {
    const html = await renderMarkdown('**你好**\n\n- A\n- B')

    expect(html).toContain('<strong>你好</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>A</li>')
  })

  it('清除危险 HTML，保留安全文本', async () => {
    const html = await renderMarkdown(
      '<script>alert(1)</script>\n\n安全文本',
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror')
    expect(html).toContain('安全文本')
  })

  it('高亮已支持语言，未知语言保留普通代码块', async () => {
    const highlighted = await renderMarkdown('```ts\nconst answer = 42\n```')
    const fallback = await renderMarkdown('```not-a-real-language\nhello\n```')

    expect(highlighted).toContain('shiki')
    expect(highlighted).toContain('const')
    expect(fallback).toContain('<pre>')
    expect(fallback).toContain('hello')
  })
})
