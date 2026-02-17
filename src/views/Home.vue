<script setup>
import { ref } from 'vue'
import Dashboard from '../components/Dashboard.vue'
import Login from '../components/Login.vue'

const props = defineProps(['token', 'isLoggedIn'])

const emit = defineEmits(['login', 'logout'])

const localToken = ref(props.token || '')

const handleLogin = (newToken) => {
  localToken.value = newToken
  emit('login', newToken)
}
</script>

<template>
  <div>
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
  </div>
</template>
