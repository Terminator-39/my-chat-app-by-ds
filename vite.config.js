/*
 * @Author: wlong
 * @Date: 2026-09-07 17:29:50
 * @LastEditTime: 2026-09-07 18:47:34
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/vite.config.js
 */
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      // '/chat': {
      //   target: 'http://127.0.0.1:8000',
      //   changeOrigin: true,
      // },
    },
  },
})
