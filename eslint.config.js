import eslintJs from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import globals from 'globals'

export default defineConfigWithVueTs(
  {
    name: 'files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },
  {
    name: 'files-to-ignore',
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'public/**',
      'deploy-retry.mjs',
      '**/*.config.{js,ts}',
      'tests/setup.ts',
    ],
  },
  eslintJs.configs.recommended,
  pluginVue.configs['flat/essential'],
  {
    name: 'vue-custom',
    rules: {
      // 页面级视图组件允许单单词命名（如 chat.vue），避免强制多单词
      'vue/multi-word-component-names': 'off',
    },
  },
  vueTsConfigs.recommended,
  {
    name: 'browser-globals',
    files: ['**/*.{ts,mts,tsx,vue}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
)
