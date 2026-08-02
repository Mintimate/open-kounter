<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from 'vue-i18n'

import ConfirmModal from '../common/ConfirmModal.vue'

const props = defineProps(['token'])
const emit = defineEmits(['changed'])
const { locale, t } = useI18n()

const counters = ref([])
const currentPage = ref(1)
const pageSize = ref(20)
const totalPages = ref(0)
const totalItems = ref(0)
const allTotal = ref(0)
const searchQuery = ref('')
const sortOption = ref('updated_at:desc')
const loading = ref(false)
const error = ref('')
let searchTimer = null

// Edit state
const showEditModal = ref(false)
const editingTarget = ref('')
const editValue = ref(0)
const editLoading = ref(false)
const editError = ref('')

// Delete confirm state
const showDeleteModal = ref(false)
const deletingTarget = ref('')
const deleteLoading = ref(false)

const loadCounters = async () => {
  loading.value = true
  error.value = ''

  try {
    const [sortBy, sortOrder] = sortOption.value.split(':')
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'list',
        page: currentPage.value,
        pageSize: pageSize.value,
        query: searchQuery.value,
        sortBy,
        sortOrder
      })
    })

    const data = await res.json()

    if (data.code === 0) {
      counters.value = data.data.items
      totalPages.value = data.data.totalPages
      totalItems.value = data.data.total
      allTotal.value = data.data.allTotal

      if (totalPages.value > 0 && currentPage.value > totalPages.value) {
        currentPage.value = totalPages.value
        await loadCounters()
      }
    } else {
      error.value = data.message
    }
  } catch (e) {
    error.value = e.message
  } finally {
    loading.value = false
  }
}

const handlePageSizeChange = () => {
  currentPage.value = 1
  loadCounters()
}

const handleSortChange = () => {
  currentPage.value = 1
  loadCounters()
}

const requestDelete = (targetKey) => {
  deletingTarget.value = targetKey
  showDeleteModal.value = true
}

const confirmDelete = async () => {
  const targetKey = deletingTarget.value
  if (!targetKey) return

  deleteLoading.value = true
  error.value = ''
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'delete',
        target: targetKey
      })
    })

    const data = await res.json()

    if (data.code === 0) {
      showDeleteModal.value = false
      deletingTarget.value = ''
      emit('changed')
      loadCounters()
    } else {
      error.value = data.message
    }
  } catch (e) {
    error.value = e.message
  } finally {
    deleteLoading.value = false
  }
}

const openEditModal = (item) => {
  editingTarget.value = item.target
  editValue.value = item.count
  editError.value = ''
  showEditModal.value = true
}

const updateCounter = async () => {
  editError.value = ''

  if (editValue.value === '' || editValue.value === null || editValue.value < 0) {
    editError.value = t('counterList.negativeValue')
    return
  }

  editLoading.value = true
  try {
    const res = await fetch('/api/counter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${props.token}`
      },
      body: JSON.stringify({
        action: 'set',
        target: editingTarget.value,
        value: Number(editValue.value)
      })
    })

    const data = await res.json()

    if (data.code === 0) {
      showEditModal.value = false
      emit('changed')
      loadCounters()
    } else {
      editError.value = data.message || t('counterList.updateFailed')
    }
  } catch (e) {
    editError.value = t('counterList.updateFailedWithMessage', { message: e.message })
  } finally {
    editLoading.value = false
  }
}

const goToPage = (page) => {
  if (page < 1 || page > totalPages.value) return
  currentPage.value = page
  loadCounters()
}

const formatDate = (timestamp) => {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString(locale.value)
}

onMounted(() => {
  loadCounters()
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
})

watch(searchQuery, () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    currentPage.value = 1
    loadCounters()
  }, 300)
})

defineExpose({ loadCounters })
</script>

<template>
  <div class="bg-dark-800 rounded-xl border border-dark-700 shadow-sm overflow-hidden relative">
    <Transition name="fade">
      <div v-if="loading" class="absolute inset-0 bg-dark-900/50 z-10 flex items-center justify-center backdrop-blur-[1px]">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    </Transition>

    <div class="flex flex-col gap-3 border-b border-dark-700 bg-dark-800/50 p-4">
      <div class="flex items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold text-white">{{ t('counterList.listTitle') }}</h3>
          <p class="mt-0.5 text-xs text-gray-500">
            {{ searchQuery ? t('counterList.matchingCount', { count: totalItems }) : t('counterList.allCount', { count: allTotal }) }}
          </p>
        </div>
        <button
          @click="loadCounters"
          :disabled="loading"
          class="button-secondary button-compact shrink-0"
        >
          {{ loading ? t('common.loading') : t('common.refresh') }}
        </button>
      </div>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <input
          v-model="searchQuery"
          type="search"
          :placeholder="t('counterList.searchPlaceholder')"
          class="form-control field-compact min-w-0"
        />
        <select
          v-model="sortOption"
          @change="handleSortChange"
          :aria-label="t('counterList.sort')"
          class="form-select field-compact min-w-36"
        >
          <option value="updated_at:desc">{{ t('counterList.newestUpdated') }}</option>
          <option value="updated_at:asc">{{ t('counterList.earliestUpdated') }}</option>
          <option value="count:desc">{{ t('counterList.countHighToLow') }}</option>
          <option value="count:asc">{{ t('counterList.countLowToHigh') }}</option>
          <option value="target:asc">Key A-Z</option>
          <option value="target:desc">Key Z-A</option>
          <option value="created_at:desc">{{ t('counterList.newestCreated') }}</option>
          <option value="created_at:asc">{{ t('counterList.earliestCreated') }}</option>
        </select>
        <select
          v-model="pageSize"
          @change="handlePageSizeChange"
          :aria-label="t('counterList.pageSize')"
          class="form-select field-compact"
        >
          <option :value="10">{{ t('counterList.perPage', { count: 10 }) }}</option>
          <option :value="20">{{ t('counterList.perPage', { count: 20 }) }}</option>
          <option :value="50">{{ t('counterList.perPage', { count: 50 }) }}</option>
          <option :value="100">{{ t('counterList.perPage', { count: 100 }) }}</option>
        </select>
      </div>
    </div>

    <div v-if="error" class="m-4 p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs">
      {{ error }}
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse table-fixed">
        <thead>
          <tr class="bg-dark-900/50 border-b border-dark-700 text-xs uppercase text-gray-400">
            <th class="px-4 py-3 font-medium">Target Key</th>
            <th class="px-4 py-3 font-medium w-24">{{ t('counterList.count') }}</th>
            <th class="px-4 py-3 font-medium w-40">{{ t('counterList.createdAt') }}</th>
            <th class="px-4 py-3 font-medium w-40">{{ t('counterList.updatedAt') }}</th>
            <th class="px-4 py-3 font-medium text-right w-32">{{ t('counterList.actions') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-dark-700 relative transition-opacity duration-300" :class="{ 'opacity-50': loading }">
            <tr v-for="item in counters" :key="item.target" class="hover:bg-dark-700/30 transition-colors">
              <td class="px-4 py-3 font-mono text-primary text-sm truncate" :title="item.target">{{ item.target }}</td>
              <td class="px-4 py-3 font-bold text-green-400 truncate" :title="item.count">{{ item.count }}</td>
              <td class="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{{ formatDate(item.created_at) }}</td>
              <td class="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{{ formatDate(item.updated_at) }}</td>
              <td class="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                <button 
                  @click="openEditModal(item)" 
                  class="text-xs text-blue-400 hover:text-blue-300 hover:underline disabled:opacity-50"
                  :disabled="loading"
                >
                  {{ t('common.edit') }}
                </button>
                <button 
                  @click="requestDelete(item.target)" 
                  class="text-xs text-danger hover:text-danger-hover hover:underline disabled:opacity-50"
                  :disabled="loading"
                >
                  {{ t('common.delete') }}
                </button>
              </td>
            </tr>
          <tr v-if="counters.length === 0 && !loading">
            <td colspan="5" class="px-4 py-8 text-center text-gray-500 text-xs">
              {{ searchQuery ? t('counterList.noMatches') : t('counterList.noData') }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    
    <!-- Pagination -->
    <div v-if="totalItems > 0" class="px-4 py-3 border-t border-dark-700 flex justify-center items-center gap-4">
      <button 
        class="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-400"
        @click="goToPage(currentPage - 1)" 
        :disabled="currentPage === 1 || loading"
      >
        {{ t('counterList.previousPage') }}
      </button>
      <span class="text-xs text-gray-500">
        {{ currentPage }} / {{ totalPages }}
      </span>
      <button 
        class="px-2 py-1 text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:hover:text-gray-400"
        @click="goToPage(currentPage + 1)" 
        :disabled="currentPage === totalPages || loading"
      >
        {{ t('counterList.nextPage') }}
      </button>
    </div>

    <!-- Edit Modal -->
    <div v-if="showEditModal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div class="bg-dark-800 border border-dark-700 rounded-xl p-6 w-full max-w-md shadow-xl">
        <h3 class="text-lg font-semibold text-white mb-4">{{ t('counterList.editTitle') }}</h3>
        
        <div class="mb-4">
          <label class="block text-xs text-gray-400 mb-1">{{ t('counterList.cannotModify') }}</label>
          <input 
            type="text" 
            :value="editingTarget" 
            disabled
            class="form-control w-full px-3 py-2 text-base md:text-sm"
          />
        </div>
        
        <div class="mb-6">
          <label class="block text-xs text-gray-400 mb-1">{{ t('counterList.countValue') }}</label>
          <input 
            type="number" 
            v-model="editValue" 
            class="form-control w-full px-3 py-2 text-base md:text-sm"
          />
        </div>
        
        <div class="flex justify-end gap-3">
          <button 
            @click="showEditModal = false"
            class="button-secondary px-4 py-2 text-sm"
            :disabled="editLoading"
          >
            {{ t('common.cancel') }}
          </button>
          <button 
            @click="updateCounter"
            class="button-primary px-4 py-2 text-sm"
            :disabled="editLoading"
          >
            {{ editLoading ? t('common.saving') : t('common.save') }}
          </button>
        </div>

        <p v-if="editError" class="mt-3 text-xs text-danger">{{ editError }}</p>
      </div>
    </div>

    <!-- Delete Confirm Modal -->
    <ConfirmModal
      :show="showDeleteModal"
      :title="t('counterList.deleteTitle')"
      variant="danger"
      :loading="deleteLoading"
      :confirm-text="t('counterList.deleteConfirm')"
      @confirm="confirmDelete"
      @cancel="showDeleteModal = false"
      @update:show="showDeleteModal = $event"
    >
      <i18n-t keypath="counterList.deleteDescription" tag="p" class="text-sm text-gray-400">
        <template #target><span class="font-mono text-primary">{{ deletingTarget }}</span></template>
      </i18n-t>
    </ConfirmModal>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
