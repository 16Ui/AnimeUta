import { Suspense, lazy } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'
import RequireAuth from './components/RequireAuth'
import RouteLoading from './components/RouteLoading'

// Layouts
const MainLayout = lazy(() => import('./components/layout/MainLayout'))

// Pages
const HomePage = lazy(() => import('./pages/HomePage'))
const SongDetailPage = lazy(() => import('./pages/SongDetailPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const FavoritesPage = lazy(() => import('./pages/FavoritesPage'))
const PlaylistsPage = lazy(() => import('./pages/PlaylistsPage'))
const PlaylistDetailPage = lazy(() => import('./pages/PlaylistDetailPage'))
const HistoryPage = lazy(() => import('./pages/HistoryPage'))
const ArtistDetailPage = lazy(() => import('./pages/ArtistDetailPage'))
const WorkDetailPage = lazy(() => import('./pages/WorkDetailPage'))
const AlbumDetailPage = lazy(() => import('./pages/AlbumDetailPage'))
const AcgEntityDetailPage = lazy(() => import('./pages/AcgEntityDetailPage'))
const AccountPage = lazy(() => import('./pages/AccountPage'))
const AdminMetadataPage = lazy(() => import('./pages/AdminMetadataPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'))
const OnlineMusicPage = lazy(() => import('./pages/OnlineMusicPage'))
const DownloadsPage = lazy(() => import('./pages/DownloadsPage'))

export const router = createBrowserRouter([
  { path: '/clients', element: <Suspense fallback={<RouteLoading />}><DownloadsPage /></Suspense> },
  {
    path: '/',
    element: (
      <Suspense fallback={<RouteLoading />}>
        <RequireAuth><MainLayout /></RequireAuth>
      </Suspense>
    ),
    children: [
      { path: 'online', element: <OnlineMusicPage /> },
      { path: 'account/sources', element: <OnlineMusicPage settings /> },
      {
        index: true,
        element: <HomePage />,
      },
      { path: 'search', element: <Navigate to="/" replace /> },
      {
        path: 'submit',
        element: <Navigate to="/online" replace />,
      },
      {
        path: 'song/:id',
        element: <SongDetailPage />,
      },
      {
        path: 'artist/:id',
        element: <ArtistDetailPage />,
      },
      {
        path: 'work/:id',
        element: <WorkDetailPage />,
      },
      {
        path: 'album/:id',
        element: <AlbumDetailPage />,
      },
      {
        path: 'creator/:id',
        element: <AcgEntityDetailPage kind="creator" />,
      },
      {
        path: 'character/:id',
        element: <AcgEntityDetailPage kind="character" />,
      },
      {
        path: 'voice-actor/:id',
        element: <AcgEntityDetailPage kind="voice_actor" />,
      },
      {
        path: 'publisher/:id',
        element: <AcgEntityDetailPage kind="publisher" />,
      },
      {
        path: 'label/:id',
        element: <AcgEntityDetailPage kind="label" />,
      },
      {
        path: 'version-group/:id',
        element: <AcgEntityDetailPage kind="version_group" />,
      },
      {
        path: 'study',
        element: (
          <RequireAuth>
            <StudyPage />
          </RequireAuth>
        ),
      },
      {
        path: 'favorites',
        element: (
          <RequireAuth>
            <FavoritesPage />
          </RequireAuth>
        ),
      },
      {
        path: 'playlists',
        element: (
          <RequireAuth>
            <PlaylistsPage />
          </RequireAuth>
        ),
      },
      {
        path: 'playlists/:id',
        element: (
          <RequireAuth>
            <PlaylistDetailPage />
          </RequireAuth>
        ),
      },
      {
        path: 'history',
        element: (
          <RequireAuth>
            <HistoryPage />
          </RequireAuth>
        ),
      },
      {
        path: 'account',
        element: (
          <RequireAuth>
            <AccountPage />
          </RequireAuth>
        ),
      },
      {
        path: 'account/profile',
        element: (
          <RequireAuth>
            <AccountPage section="profile" />
          </RequireAuth>
        ),
      },
      {
        path: 'account/password',
        element: (
          <RequireAuth>
            <AccountPage section="password" />
          </RequireAuth>
        ),
      },
      {
        path: 'account/sessions',
        element: (
          <RequireAuth>
            <AccountPage section="sessions" />
          </RequireAuth>
        ),
      },
      { path: 'admin/review', element: <Navigate to="/admin/songs" replace /> },
      { path: 'admin/lyrics', element: <Navigate to="/admin/songs" replace /> },
      {
        path: 'admin/songs',
        element: (
          <RequireAuth>
            <AdminMetadataPage />
          </RequireAuth>
        ),
      },
      {
        path: 'admin/songs/:id',
        element: (
          <RequireAuth>
            <AdminMetadataPage />
          </RequireAuth>
        ),
      },
      {
        path: 'admin/users',
        element: <AdminUsersPage />,
      },
      {
        path: 'admin/metadata',
        element: <Navigate to="/admin/songs" replace />,
      },
    ],
  },
  {
    path: '/login',
    element: (
      <Suspense fallback={<RouteLoading />}>
        <LoginPage />
      </Suspense>
    ),
  },
])
