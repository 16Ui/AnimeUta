import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './ui-polish.css'
import './i18n'
import { configureAuthRefresh } from './api/http'
import { useAuthStore } from './store/useAuthStore'
import { removeLegacyPwa } from './lib/removeLegacyPwa'

removeLegacyPwa()

configureAuthRefresh(
  () => useAuthStore.getState().refreshAccessToken(),
  () => useAuthStore.getState().clearLocalAuth(),
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
