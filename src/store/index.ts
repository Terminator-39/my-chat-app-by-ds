/*
 * @Author: wlong
 * @Date: 2026-09-09 12:43:37
 * @LastEditTime: 2026-09-09 12:50:23
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/src/store/index.ts
 */
import { defineStore } from 'pinia'

export interface UserInfo {
  username: string
  token: string
  sessionId:string
}

export const useUserStore = defineStore('user', {
  state: (): { userInfo: UserInfo | null } => ({
    userInfo: null,
  }),
  actions: {
    setUserInfo(userInfo: UserInfo) {
      this.userInfo = userInfo
    },
    clearUserInfo() {
      this.userInfo = null
    },
  },
})
