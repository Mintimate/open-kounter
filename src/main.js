import { createApp } from 'vue'

import App from './App.vue'
import router from './router'
import './style.css'
import { applyThemeMode, getStoredThemeMode } from './theme.js'

applyThemeMode(getStoredThemeMode())

const app = createApp(App)
app.use(router)
app.mount('#app')
