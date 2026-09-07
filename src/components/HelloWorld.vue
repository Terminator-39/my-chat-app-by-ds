<script setup lang="ts">
import { ref } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { useRouter } from 'vue-router'
import { login } from '../api/user'

interface LoginForm {
  username: string
  password: string
}

const router = useRouter()
const formRef = ref<FormInstance>()
const loading = ref(false)
const form = ref<LoginForm>({ username: '', password: '' })
const rules: FormRules<LoginForm> = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 50, message: '用户名长度为 2-50 位', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' },
  ],
}

async function submit() {
  if (!formRef.value || !(await formRef.value.validate())) return

  loading.value = true
  try {
    const token = await login(form.value)
    localStorage.setItem('access_token', token)
    ElMessage.success('登录成功，欢迎回来')
    await router.push({ name: 'chat' })
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '登录失败，请稍后重试')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="login-page">
    <div class="glow glow-one" />
    <div class="glow glow-two" />
    <section class="login-card">
      <div class="brand-mark">✦</div>
      <p class="eyebrow">WELCOME BACK</p>
      <h1>开启你的对话</h1>
      <p class="subtitle">登录后，继续探索灵感与连接。</p>

      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="submit">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" size="large" placeholder="请输入用户名" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            size="large"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button class="login-button" native-type="submit" type="primary" size="large" :loading="loading">
          进入 Chat <span aria-hidden="true">→</span>
        </el-button>
      </el-form>
    </section>
  </main>
</template>

<style scoped>
.login-page { position: relative; display: grid; min-height: 100svh; place-items: center; overflow: hidden; padding: 24px; box-sizing: border-box; background: linear-gradient(145deg, #18132d, #34235d 52%, #8d4a85); }
.login-card { position: relative; z-index: 1; width: min(100%, 390px); padding: 42px 32px 36px; border: 1px solid rgba(255,255,255,.2); border-radius: 28px; box-sizing: border-box; color: #fff; background: rgba(21,16,44,.55); box-shadow: 0 24px 80px rgba(8,5,24,.35); backdrop-filter: blur(24px); }
.brand-mark { display: grid; width: 48px; height: 48px; margin-bottom: 28px; place-items: center; border-radius: 15px; font-size: 25px; background: linear-gradient(135deg, #d4a7ff, #8b5cf6); box-shadow: 0 8px 24px rgba(164,109,255,.45); }
.eyebrow { margin: 0 0 8px; color: #cbb8f5; font-size: 12px; letter-spacing: 3px; }
h1 { margin: 0; color: #fff; font-size: clamp(30px, 8vw, 42px); letter-spacing: -1px; }
.subtitle { margin: 12px 0 30px; color: #c9c2d9; font-size: 14px; }
.login-button { width: 100%; margin-top: 10px; border: 0; background: linear-gradient(90deg, #9d6cff, #d178d1); }
.login-button span { margin-left: 10px; font-size: 20px; }
.glow { position: absolute; width: 240px; height: 240px; border-radius: 50%; filter: blur(8px); opacity: .35; }
.glow-one { top: -80px; right: -60px; background: #ba8cff; }
.glow-two { bottom: -100px; left: -80px; background: #ff86c8; }
</style>
