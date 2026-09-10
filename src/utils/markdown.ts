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

interface MermaidApi {
  initialize(config: {
    startOnLoad: boolean
    securityLevel: 'strict'
    theme: 'dark'
  }): void
  render(id: string, code: string): Promise<{ svg: string }>
}

let mermaidPromise: Promise<MermaidApi> | undefined

/**
 * 按需加载并初始化 Mermaid，避免普通 Markdown 消息承担图表依赖成本。
 * @returns 可复用的 Mermaid 实例
 */
function loadMermaid(): Promise<MermaidApi> {
  // Mermaid 只在实际出现 mermaid 代码块时加载，普通 Markdown 不增加首屏成本。
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'dark',
    })
    return mermaid
  })
  return mermaidPromise
}

let mermaidRenderId = 0

interface Highlighter {
  codeToHtml(code: string, options: { lang: string; theme: string }): string
}

let highlighterPromise: Promise<Highlighter> | undefined

/**
 * 按需创建 Shiki 高亮器，并只加载项目支持的语言和主题。
 * @returns 可复用的 Shiki 高亮器
 */
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

/**
 * 从代码节点的 language-* class 中提取并标准化语言名。
 * @param node Markdown 转换后的代码节点
 * @returns 标准化语言名；没有语言标记时返回 undefined
 */
function getLanguage(node: HastNode): string | undefined {
  const className = node.properties?.className ?? []
  const languageClass = className.find((name) => name.startsWith('language-'))
  if (!languageClass) return undefined
  const language = languageClass.slice('language-'.length).toLowerCase()
  return languageAliases[language] ?? language
}

/**
 * 递归提取 HAST 节点中的纯文本代码。
 * @param node HAST 节点
 * @returns 节点及其子节点拼接后的代码文本
 */
function getCodeText(node: HastNode): string {
  return (node.children ?? [])  // 如果节点没有children属性，则使用空数组
    .map((child) => (child.type === 'text' ? child.value ?? '' : getCodeText(child)))  // 遍历子节点，如果是文本节点则返回其值，否则递归处理
    .join('')  // 将所有文本内容拼接成字符串
}

/**
 * 遍历 Markdown 语法树，将 Mermaid 和支持的代码块替换为渲染结果。
 * @param node 当前 HAST 节点
 * @returns 处理完成的 Promise；失败时保留普通代码块作为降级结果
 */
async function highlightCodeBlocks(node: HastNode): Promise<void> {
  if (!node.children) return

  for (let index = 0; index < node.children.length; index += 1) {
    const child = node.children[index]
    if (child.type === 'element' && child.tagName === 'pre') {
      const code = child.children?.find(
        (item) => item.type === 'element' && item.tagName === 'code',
      )
      const language = code ? getLanguage(code) : undefined

      if (code && language === 'mermaid') {
        try {
          const { svg } = await (await loadMermaid()).render(
            `mermaid-${mermaidRenderId++}`,
            getCodeText(code),
          )
          // Mermaid 只生成 SVG，不把原始图表文本直接当 HTML 插入页面。
          node.children[index] = { type: 'raw', value: svg }
          continue
        } catch {
          // 流式内容未闭合或语法错误时，保留普通代码块作为安全降级。
        }
      }

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
 * 将 Markdown 文本转换为经过高亮、图表处理和 XSS 清洗的 HTML。
 * @param markdown Markdown 源文本
 * @returns 可安全交给 v-html 使用的 HTML 字符串
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
  const html = processor.stringify(
    // 对 unified 的 stringify 来说，第一个参数就是 compiler（rehype-stringify）期望的输入树类型，也就是 hast 的 Root。
    tree as Parameters<typeof processor.stringify>[0],
  )

  // 即使 remark 默认不会执行原始 HTML，也在进入 v-html 前做最后一道清洗。
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
  })
}
