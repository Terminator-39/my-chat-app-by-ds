import DOMPurify from 'dompurify'
import { unified } from 'unified'
import rehypeStringify from 'rehype-stringify'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'

// 处理器只创建一次；流式更新时复用它，避免每个 chunk 重建解析器。
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify)

export function renderMarkdown(markdown: string): string {
  const tree = processor.runSync(processor.parse(markdown))
  const html = processor.stringify(tree)

  // 即使 remark 默认不会执行原始 HTML，也在进入 v-html 前做最后一道清洗。
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
