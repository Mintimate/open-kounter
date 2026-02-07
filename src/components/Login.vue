<script setup>
import { onMounted, ref } from 'vue'

const emit = defineEmits(['login'])

const tokenInput = ref('')
const isInitialized = ref(true)
const loading = ref(false)
const message = ref('')

const checkInitStatus = async () => {
  try {
    // Try to auth with a dummy token to check if system is initialized
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'check_init' })
    })
    const data = await res.json()
    // Check if system is not initialized
    if (data.code !== 0 && data.message === 'Not initialized') {
      isInitialized.value = false
    } else {
      isInitialized.value = true
    }
  } catch (e) {
    console.error(e)
    // On error, assume not initialized to be safe
    isInitialized.value = false
  }
}

onMounted(() => {
  checkInitStatus()
})

const handleSubmit = async () => {
  if (!tokenInput.value) return
  loading.value = true
  message.value = ''

  try {
    if (!isInitialized.value) {
      // Initialize
      const res = await fetch('/api/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.value })
      })
      const data = await res.json()
      if (data.code === 0) {
        message.value = '初始化成功！正在登录...'
        emit('login', tokenInput.value)
      } else {
        message.value = data.message
      }
    } else {
      // Login
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tokenInput.value })
      })
      const data = await res.json()
      if (data.code === 0) {
        emit('login', tokenInput.value)
      } else {
        message.value = data.message
      }
    }
  } catch (e) {
    message.value = e.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md bg-dark-800 rounded-xl shadow-xl border border-dark-700 p-8">
    <div class="text-center mb-8">
      <h2 class="text-2xl font-bold text-primary mb-2">{{ isInitialized ? '系统登录' : '初始化设置' }}</h2>
      <p v-if="!isInitialized" class="text-sm text-gray-400">初次使用请设置管理员 Token</p>
    </div>
    
    <div class="space-y-6">
      <div>
        <input 
          type="password" 
          v-model="tokenInput" 
          placeholder="请输入 Token" 
          @keyup.enter="handleSubmit" 
          class="w-full px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-200"
        />
      </div>
      
      <button 
        @click="handleSubmit" 
        :disabled="loading"
        class="w-full py-3 bg-primary hover:bg-primary-hover text-white font-medium rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
      >
        <svg v-if="loading" class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>{{ loading ? '处理中...' : (isInitialized ? '登录' : '设置并登录') }}</span>
      </button>
      
      <div 
        v-if="message" 
        class="p-3 rounded-lg text-sm text-center"
        :class="message.includes('成功') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'"
      >
        {{ message }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--bg-card);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 40px;
  border: 1px solid var(--border-color);
}

.card-header {
  text-align: center;
  margin-bottom: 30px;
}

.card-header h2 {
  margin: 0 0 10px;
  color: var(--primary-color);
  font-size: 24px;
}

.subtitle {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.input-group {
  margin-bottom: 20px;
}

.custom-input {
  width: 100%;
  padding: 12px;
  background: var(--bg-input);
  border: 1px solid var(--border-color);
  border-radius: var(--border-radius);
  color: var(--text-primary);
  font-size: 16px;
  box-sizing: border-box;
  transition: border-color 0.3s;
}

.custom-input:focus {
  outline: none;
  border-color: var(--primary-color);
}

.submit-btn {
  width: 100%;
  padding: 12px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: var(--border-radius);
  font-size: 16px;
  cursor: pointer;
  transition: background 0.3s;
  font-weight: 500;
}

.submit-btn:hover:not(:disabled) {
  background: var(--primary-hover);
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.message-box {
  margin-top: 20px;
  padding: 10px;
  border-radius: var(--border-radius);
  font-size: 14px;
  text-align: center;
  background: rgba(103, 194, 58, 0.1);
  color: var(--success-color);
}

.message-box.error {
  background: rgba(245, 108, 108, 0.1);
  color: var(--danger-color);
}
</style>
