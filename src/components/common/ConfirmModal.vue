<script setup>
import { ref, watch } from 'vue'

import { useI18n } from 'vue-i18n'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  variant: { type: String, default: 'primary' }, // 'primary' | 'danger' | 'warning'
  confirmText: { type: String, default: '' },
  cancelText: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  requireConfirmInput: { type: String, default: '' }, // 需要输入确认文本时设置
})

const emit = defineEmits(['confirm', 'cancel', 'update:show'])
const { t } = useI18n()

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
  primary: 'button-primary',
  danger: 'button-danger-solid',
  warning: 'button-warning'
}
</script>

<template>
  <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
    <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-2xl max-w-md w-full p-6 space-y-6">
      <!-- Header -->
      <div>
        <h3 class="text-xl font-bold text-white mb-2">{{ title || t('confirmModal.defaultTitle') }}</h3>
        <slot></slot>
      </div>

      <!-- Confirm Input -->
      <div v-if="requireConfirmInput" class="space-y-2">
        <i18n-t keypath="confirmModal.inputHint" tag="label" class="block text-sm text-gray-300">
          <template #text><span class="select-all font-mono text-red-400 bg-red-500/10 px-1 rounded">{{ requireConfirmInput }}</span></template>
        </i18n-t>
        <input 
          v-model="inputValue" 
          type="text" 
          class="form-control w-full px-3 py-2 text-base focus:border-danger focus:ring-danger/20 md:text-sm"
          :placeholder="t('confirmModal.inputPlaceholder')"
        />
      </div>

      <!-- Actions -->
      <div class="flex gap-3 pt-2">
        <button 
          @click="handleCancel" 
          :disabled="loading"
          class="button-secondary flex-1 px-3 py-2 text-sm"
        >
          {{ cancelText || t('common.cancel') }}
        </button>
        <button 
          @click="handleConfirm" 
          :disabled="isConfirmDisabled()"
          :class="variantClasses[variant]"
          class="flex-1 px-3 py-2 text-sm"
        >
          {{ loading ? t('common.processing') : (confirmText || t('common.confirm')) }}
        </button>
      </div>
    </div>
  </div>
</template>
