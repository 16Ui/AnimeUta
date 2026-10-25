import React from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { setBackendBaseUrl } from '../src/api/http'
import '../src/i18n'
import '../src/index.css'

setBackendBaseUrl('http://127.0.0.1:5189')
const { default: LoginPage } = await import('../src/pages/LoginPage')
const { useAuthStore } = await import('../src/store/useAuthStore')
function SignedIn() {
  const navigate = useNavigate()
  return <main><h1>Fixture login successful</h1><button onClick={async () => { await useAuthStore.getState().clearAuth(); navigate('/login') }}>Sign out fixture</button></main>
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/login']}>
    <Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<SignedIn />} /></Routes>
  </MemoryRouter></QueryClientProvider>,
)
