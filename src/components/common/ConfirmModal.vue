<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  variant: { type: String, default: 'primary' }, // 'primary' | 'danger' | 'warning'
  confirmText: { type: String, default: '确认' },
  cancelText: { type: String, default: '取消' },
  loading: { type: Boolean, default: false },
  requireConfirmInput: { type: String, default: '' }, // 需要输入确认文本时设置
})

const emit = defineEmits(['confirm', 'cancel', 'update:show'])

const inputValue = ref('')

watch(() => props.show, (val) => {
  if (!val) {
    inputValue.value = ''
  }
})

const isConfirmDisabled = () => {
  if (props.loading) return true
  if (props.requireConfirmInput && inputValue.value !== props.requireConfirmInput) return true
  return false
}

const handleConfirm = () => {
  if (!isConfirmDisabled()) {
    emit('confirm')
  }
}

const handleCancel = () => {
  emit('cancel')
  emit('update:show', false)
}

const variantClasses = {
  primary: 'bg-primary hover:bg-primary-dark',
  danger: 'bg-red-600 hover:bg-red-500',
  warning: 'bg-amber-500 hover:bg-amber-600'
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-2xl max-w-md w-full p-6 space-y-6">
      <!-- Header -->
      <div>
        <h3 class="text-xl font-bold text-white mb-2">{{ title }}</h3>
        <slot></slot>
      </div>

      <!-- Confirm Input -->
      <div v-if="requireConfirmInput" class="space-y-2">
        <label class="block text-sm text-gray-300">
          请输入 <span class="select-all font-mono text-red-400 bg-red-500/10 px-1 rounded">{{ requireConfirmInput }}</span> 以继续：
        </label>
        <input 
          v-model="inputValue" 
          type="text" 
          class="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-sm text-white focus:outline-none focus:border-red-500 transition-colors"
          placeholder="在此输入确认文本"
        />
      </div>

      <!-- Actions -->
      <div class="flex gap-3 pt-2">
        <button 
          @click="handleCancel" 
          :disabled="loading"
          class="flex-1 py-2 bg-dark-700 hover:bg-dark-600 text-white text-sm rounded-lg transition-colors border border-dark-600 disabled:opacity-50"
        >
          {{ cancelText }}
        </button>
        <button 
          @click="handleConfirm" 
          :disabled="isConfirmDisabled()"
          :class="variantClasses[variant]"
          class="flex-1 py-2 text-white text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
        >
          {{ loading ? '处理中...' : confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>
