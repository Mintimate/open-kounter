<script setup>
import { onMounted, ref } from 'vue'
import Dashboard from './components/Dashboard.vue'
import Login from './components/Login.vue'

const token = ref(localStorage.getItem('open_kounter_token') || '')
const isLoggedIn = ref(false)

const handleLogin = (newToken) => {
  token.value = newToken
  localStorage.setItem('open_kounter_token', newToken)
  isLoggedIn.value = true
}

const handleLogout = () => {
  token.value = ''
  localStorage.removeItem('open_kounter_token')
  isLoggedIn.value = false
}

onMounted(async () => {
  if (token.value) {
    // Verify token
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.value })
      })
      const data = await res.json()
      if (data.code === 0) {
        isLoggedIn.value = true
      } else {
        handleLogout()
      }
    } catch (e) {
      console.error(e)
      handleLogout()
    }
  }
})
</script>

<template>
  <div class="min-h-screen bg-dark-900 text-gray-200">
    <header class="sticky top-0 z-50 bg-dark-800/80 backdrop-blur-md border-b border-dark-700 shadow-sm">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <span class="text-xl">🔢</span>
          <h1 class="text-base font-semibold text-white tracking-wide">Open Kounter <span class="text-xs text-gray-400 font-normal ml-1">管理后台</span></h1>
        </div>
        <button 
          v-if="isLoggedIn" 
          @click="handleLogout" 
          class="px-3 py-1 text-xs text-gray-300 hover:text-red-400 border border-dark-600 hover:border-red-500/50 hover:bg-red-500/10 rounded-md transition-all duration-200"
        >
          退出登录
        </button>
      </div>
    </header>
    
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div v-if="isLoggedIn">
        <Dashboard :token="token" />
      </div>
      <div v-else class="flex items-center justify-center min-h-[calc(100vh-200px)]">
        <Login @login="handleLogin" />
      </div>
    </main>
  </div>
</template>

<style>
/* Global overrides if needed */
</style>
