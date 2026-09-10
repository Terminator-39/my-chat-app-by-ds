import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../../src/utils/markdown'

describe('renderMarkdown', () => {
  it('渲染 GFM Markdown', () => {
    const html = renderMarkdown('**你好**\n\n- A\n- B')

    expect(html).toContain('<strong>你好</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>A</li>')
  })

  it('清除危险 HTML，保留安全文本', () => {
    const html = renderMarkdown(
      '<script>alert(1)</script>\n\n安全文本',
    )

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('onerror')
    expect(html).toContain('安全文本')
  })
})
