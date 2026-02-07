<script setup>
import { onMounted, ref } from 'vue'
import Dashboard from './components/Dashboard.vue'
import Login from './components/Login.vue'

const token = ref(localStorage.getItem('open_kounter_token') || '')
const isLoggedIn = ref(false)
const isLoading = ref(true)

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
    } finally {
      isLoading.value = false
    }
  } else {
    isLoading.value = false
  }
})
</script>

<template>
  <div class="min-h-screen bg-dark-900 text-gray-200 font-sans selection:bg-primary selection:text-white">
    <div v-if="isLoading" class="fixed inset-0 z-50 flex items-center justify-center bg-dark-900">
      <div class="flex flex-col items-center gap-4">
        <div class="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin"></div>
        <div class="text-gray-400 text-sm animate-pulse">Loading...</div>
      </div>
    </div>

    <template v-else>
      <header class="sticky top-0 z-40 bg-dark-800/80 backdrop-blur-xl border-b border-dark-700/50 shadow-lg shadow-dark-900/20">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3 group cursor-default">
            <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg shadow-primary/20 group-hover:shadow-primary/40 transition-all duration-300 overflow-hidden">
              <img src="/favicon.png" alt="Logo" class="w-5 h-5 object-contain" />
            </div>
            <div class="flex flex-col">
              <h1 class="text-lg font-bold text-white tracking-tight leading-none group-hover:text-primary transition-colors duration-300">
                Open Kounter
              </h1>
              <span class="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none mt-1">Admin Dashboard</span>
            </div>
          </div>
          <button 
            v-if="isLoggedIn" 
            @click="handleLogout" 
            class="group flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-400 hover:text-white bg-dark-700/50 hover:bg-red-500/10 border border-dark-600 hover:border-red-500/50 rounded-lg transition-all duration-200"
          >
            <span>退出登录</span>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 group-hover:translate-x-0.5 transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>
      
      <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <transition
          enter-active-class="transition ease-out duration-200"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition ease-in duration-150"
          leave-from-class="opacity-100 translate-y-0"
          leave-to-class="opacity-0 translate-y-2"
          mode="out-in"
        >
          <div v-if="isLoggedIn" key="dashboard">
            <Dashboard :token="token" />
          </div>
          <div v-else key="login" class="flex items-center justify-center min-h-[calc(100vh-200px)]">
            <Login @login="handleLogin" />
          </div>
        </transition>
      </main>
    </template>
  </div>
</template>

<style>
/* Global overrides if needed */
</style>
