import { createBrowserRouter } from 'react-router-dom'
import { Suspense, lazy } from 'react'

// Layouts
const MainLayout = lazy(() => import('./components/layout/MainLayout'))

// Pages
const HomePage = lazy(() => import('./pages/HomePage'))
const SearchPage = lazy(() => import('./pages/SearchPage'))
const SongDetailPage = lazy(() => import('./pages/SongDetailPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'))

export const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <Suspense fallback={<div>Loading...</div>}>
        <MainLayout />
      </Suspense>
    ),
    children: [
      {
        index: true,
        element: <HomePage />,
      },
      {
        path: 'search',
        element: <SearchPage />,
      },
      {
        path: 'song/:id',
        element: <SongDetailPage />,
      },
      {
        path: 'favorites',
        element: <FavoritesPage />,
      },
    ],
  },
  {
    path: '/login',
    element: (
      <Suspense fallback={<div>Loading...</div>}>
        <LoginPage />
      </Suspense>
    ),
  },
])
