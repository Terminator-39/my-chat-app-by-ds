/*
 * @Author: wlong
 * @Date: 2026-09-07 17:54:58
 * @LastEditTime: 2026-09-07 19:05:20
 * @LastEditors: wlong
 * @Description: 
 * @FilePath: /Demo_26_07/Demo_Front/my-chat-app/src/api/http.ts
 */
import axios from 'axios'

const http = axios.create({
  baseURL: '',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export default http
