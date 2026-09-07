/*
 * @Author: wlong
 * @Date: 2026-09-07 17:39:28
 * @LastEditTime: 2026-09-07 17:41:39
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/src/router/index.ts
 */
import { createRouter, createWebHistory } from 'vue-router'
import HelloWorld from '../components/HelloWorld.vue'
import Chat from '../views/chat.vue'

export default createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HelloWorld,
    },
    {
      path: '/chat',
      name: 'chat',
      component: Chat,
    },
  ],
})
