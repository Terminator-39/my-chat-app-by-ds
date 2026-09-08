/*
 * @Author: wlong
 * @Date: 2026-09-07 21:43:25
 * @LastEditTime: 2026-09-07 21:43:58
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/deploy-retry.mjs
 */
/*
 * @Description: 直连 GitHub 不稳定时的 gh-pages 部署脚本。
 * 思路：gh-pages 会复用 node_modules/.cache/gh-pages 下已存在的 clone，
 * 所以先带重试地把仓库预热进缓存（绕过"全量 clone 被网络重置"），
 * 之后真正的 publish 只做增量 fetch + push，成功率大增。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// gh-pages 缓存根目录（与其内部 find-cache-dir 的结果一致）
const cacheRoot = path.join(__dirname, 'node_modules', '.cache', 'gh-pages')

// 解析仓库地址：与 gh-pages 相同，取 git remote.origin.url（会向上找最近的 .git）
const urlRes = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
  encoding: 'utf-8',
})
if (urlRes.status !== 0 || !urlRes.stdout.trim()) {
  console.error('无法从 remote.origin.url 解析仓库地址，请确认在 git 仓库内运行。')
  process.exit(1)
}
const repoUrl = urlRes.stdout.trim()
// 复刻 gh-pages 的 filenamify：URL 中连续非法字符合并成一个 !（如 https:// -> https!）
const cacheDir = path.join(cacheRoot, repoUrl.replace(/[\\/:*?"<>|]+/g, '!'))

// 第一步：预热缓存（仅当缓存缺失或损坏时执行，带重试）
if (!fs.existsSync(path.join(cacheDir, '.git'))) {
  console.log(`预热 gh-pages 缓存：${repoUrl}`)
  const maxAttempts = 10
  let cloned = false
  for (let i = 1; i <= maxAttempts; i++) {
    fs.rmSync(cacheDir, { recursive: true, force: true })
    console.log(`  git clone 第 ${i}/${maxAttempts} 次 ...`)
    const clone = spawnSync('git', ['clone', repoUrl, cacheDir], {
      stdio: 'inherit',
    })
    if (clone.status === 0) {
      console.log('  缓存预热成功')
      cloned = true
      break
    }
    console.log('  被网络中断，稍后重试 ...')
  }
  if (!cloned) {
    console.error('预热失败：多次 clone 均被网络中断。请稍后重试，或先配置代理。')
    process.exit(1)
  }
} else {
  console.log('gh-pages 缓存已存在，跳过预热')
}

// 第二步：发布（push 网络抖动时自动重试；缓存有效时每次只是增量 fetch + push）
const ghpagesBin = path.join(
  __dirname,
  'node_modules',
  '.bin',
  'gh-pages',
)
const maxPublish = 3
for (let i = 1; i <= maxPublish; i++) {
  console.log(`gh-pages 发布第 ${i}/${maxPublish} 次 ...`)
  const pub = spawnSync(ghpagesBin, ['-d', 'dist'], { stdio: 'inherit' })
  if (pub.status === 0) {
    console.log('部署成功')
    process.exit(0)
  }
  console.log('发布失败，稍后重试 ...')
}

console.error('发布多次失败，请检查网络后重试。')
process.exit(1)
