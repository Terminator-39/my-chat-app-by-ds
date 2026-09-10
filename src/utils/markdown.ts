import DOMPurify from 'dompurify'
import { unified } from 'unified'
import rehypeStringify from 'rehype-stringify'
import remarkRehype from 'remark-rehype'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
// 处理器只创建一次；流式更新时复用它，避免每个 chunk 重建解析器。
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeStringify, { allowDangerousHtml: true })

const supportedLanguages = new Set([
  'bash',
  'javascript',
  'json',
  'python',
  'typescript',
])

interface Highlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string
}

let highlighterPromise: Promise<Highlighter> | undefined

function loadHighlighter(): Promise<Highlighter> {
  // 只有遇到已支持的 fenced code block 时才加载 Shiki，避免普通聊天首屏加载高亮器。
  highlighterPromise ??= Promise.all([
    import('@shikijs/langs/bash'),
    import('@shikijs/langs/javascript'),
    import('@shikijs/langs/json'),
    import('@shikijs/langs/python'),
    import('@shikijs/langs/typescript'),
    import('@shikijs/themes/github-dark'),
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ]).then(
    ([bash, javascript, json, python, typescript, githubDark, core, engine]) =>
      core.createHighlighterCore({
        themes: [githubDark.default],
        langs: [
          bash.default,
          javascript.default,
          json.default,
          python.default,
          typescript.default,
        ],
        engine: engine.createJavaScriptRegexEngine(),
      }),
  )
  return highlighterPromise
}

const languageAliases: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
}

interface HastNode {
  type: string
  tagName?: string
  properties?: { className?: string[] }
  children?: HastNode[]
  value?: string
}

function getLanguage(node: HastNode): string | undefined {
  const className = node.properties?.className ?? []
  const languageClass = className.find((name) => name.startsWith('language-'))
  if (!languageClass) return undefined
  const language = languageClass.slice('language-'.length).toLowerCase()
  return languageAliases[language] ?? language
}

function getCodeText(node: HastNode): string {
  return (node.children ?? [])
    .map((child) => (child.type === 'text' ? child.value ?? '' : getCodeText(child)))
    .join('')
}

async function highlightCodeBlocks(node: HastNode): Promise<void> {
  if (!node.children) return

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (child.type === 'element' && child.tagName === 'pre') {
      const code = child.children?.find(
        (item) => item.type === 'element' && item.tagName === 'code',
      )
      const language = code ? getLanguage(code) : undefined

      if (code && language && supportedLanguages.has(language)) {
        try {
          const highlighted = (await loadHighlighter()).codeToHtml(getCodeText(code), {
            lang: language,
            theme: 'github-dark',
          })
          // 用 Shiki 生成的 HTML 替换原始 pre，最终仍会经过 DOMPurify。
          node.children[index] = { type: 'raw', value: highlighted }
          continue
        } catch {
          // 未知语言保留普通代码块，不能因为高亮失败丢失用户内容。
        }
      }
    }
    await highlightCodeBlocks(child)
  }
}

/**
 * 将 Markdown 文本渲染为 HTML 字符串
 * @param markdown - 要渲染的 Markdown 格式文本
 * @returns Promise<string> - 渲染后的 HTML 字符串，经过安全处理
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  // 使用 processor 解析 Markdown 并转换为语法树 (HastNode)
  const tree = (await processor.run(processor.parse(markdown))) as HastNode
  // 语法树中的代码块进行语法高亮处理
  await highlightCodeBlocks(tree)
  /**
   * unified 的 processor.process(md) = parse + run + stringify 一条龙。
   * 这里故意拆开，就是为了在 run 之后、stringify 之前插一脚：---
   * --- highlightCodeBlocks(tree) 需要遍历 hast 里的 pre > code 节点，用 Shiki 生成高亮 HTML 再替换回语法树。
   * 这一步必须在「已转成 hast、还没变成字符串」的中间态做，最后才由 processor.stringify() 输出。
   */
  // 将处理后的语法树转换为 HTML 字符串
  const html = processor.stringify(tree as any)

  // 即使 remark 默认不会执行原始 HTML，也在进入 v-html 前做最后一道清洗。
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
