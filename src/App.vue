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
      <header v-if="isLoggedIn" class="sticky top-0 z-40 bg-dark-800/80 backdrop-blur-xl border-b border-dark-700/50 shadow-lg shadow-dark-900/20">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div class="flex items-center gap-3 group cursor-default">
            <div class="relative w-8 h-8">
              <div class="absolute -inset-1 bg-gradient-to-r from-primary via-purple-500 to-blue-500 rounded-full blur-md opacity-20 group-hover:opacity-60 transition duration-500 animate-gradient-xy"></div>
              <div class="relative w-8 h-8 flex items-center justify-center">
                <img src="/favicon.png" alt="Logo" class="w-7 h-7 object-contain drop-shadow-lg transform group-hover:rotate-12 transition-transform duration-300" />
              </div>
            </div>
            <div class="flex flex-col items-start">
              <h1 class="text-lg font-bold text-white tracking-tight leading-none group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-primary group-hover:to-purple-500 transition-all duration-300">
                Open Kounter
              </h1>
              <span class="text-[10px] text-gray-500 font-medium uppercase tracking-wider leading-none mt-1">即刻 KV 计数，简单可视化</span>
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

      <footer class="mt-auto text-center border-t border-dark-700/50 pt-8 pb-8 bg-dark-900/50 backdrop-blur-sm">
        <div class="flex justify-center items-center gap-6 mb-4">
          <a href="https://github.com/Mintimate/open-kounter" target="_blank" class="flex items-center text-sm font-medium text-gray-400 hover:text-primary transition-colors">
            <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clip-rule="evenodd" /></svg>
            GitHub
          </a>
          <span class="text-dark-600">|</span>
          <a href="https://cnb.cool/Mintimate/tool-forge/open-kounter" target="_blank" class="flex items-center text-sm font-medium text-gray-400 hover:text-primary transition-colors">
            <svg class="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            CNB
          </a>
        </div>
        <p class="text-sm text-gray-500">
          Designed by <a href="https://www.mintimate.cn" target="_blank" class="font-medium text-gray-400 hover:text-primary transition-colors">Mintimate</a>
          <span class="mx-2">·</span>
          Powered by EdgeOne Pages
        </p>
      </footer>
    </template>
  </div>
</template>

<style>
/* Global overrides if needed */
.animate-gradient-xy {
  background-size: 200% 200%;
  animation: gradient-xy 3s ease infinite;
}

@keyframes gradient-xy {
  0%, 100% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
}
</style>
