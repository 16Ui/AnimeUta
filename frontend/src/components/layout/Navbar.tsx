import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { listPlaylists } from '../../api/playlists'
import {
  BookOpenCheck,
  Clock3,
  Compass,
  Heart,
  Library,
  ListMusic,
  LogOut,
  PencilLine,
  UserCircle,
  Users,
  ArrowLeft,
  Download,
} from 'lucide-react'
import { resolveMediaUrl } from '../../api/http'
import { useAuthStore } from '../../store/useAuthStore'

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex h-10 items-center gap-3 rounded-md px-3 text-sm transition ${
    isActive ? 'bg-[#ff3b5f] font-medium text-white shadow-[0_8px_22px_rgba(255,59,95,0.18)]' : 'text-zinc-400 hover:bg-white/[0.055] hover:text-white'
  }`

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex min-w-0 h-14 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium transition ${
    isActive ? 'text-[#ff6b85]' : 'text-zinc-400 active:bg-white/[0.06] active:text-white'
  }`

export default function Navbar() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const currentUser = useAuthStore((state) => state.currentUser)
  const token = useAuthStore((state) => state.token)
  const playlists = useQuery({ queryKey: ['playlists', token], queryFn: () => listPlaylists(token as string), enabled: Boolean(token) })
  const clearAuth = useAuthStore((state) => state.clearAuth)

  const currentLanguage = i18n.resolvedLanguage?.slice(0, 2) ?? 'zh'
  const isAdmin = currentUser?.role === 'admin' || currentUser?.role === 'owner'
  const section = pathname.startsWith('/study') ? 'study' : pathname.startsWith('/favorites') ? 'favorites' : pathname.startsWith('/playlists') ? 'playlists' : pathname.startsWith('/history') ? 'history' : pathname.startsWith('/account') ? 'account' : 'home'
  const primaryPage = ['/', '/study', '/favorites', '/playlists', '/account'].includes(pathname)
  const pageTitle = pathname === '/submit' ? t('song.submit.title') : pathname.startsWith('/admin/songs') ? t('nav.adminMetadata') : pathname.startsWith('/admin/users') ? t('nav.adminUsers') : section !== 'home' || pathname === '/' ? t(`nav.${section}`) : 'AnimeUta'
  const goBack = () => window.history.state?.idx > 0 ? navigate(-1) : navigate('/')

  return (
    <>
      <aside className="app-sidebar fixed bottom-24 left-0 top-0 z-30 hidden w-[232px] border-r border-white/[0.055] bg-[#18181e] md:block">
        <div className="flex h-full flex-col overflow-y-auto">
          <div className="flex h-16 items-center gap-3 px-5">
            <img
              src="/animeuta-icon-192.png"
              alt=""
              className="h-9 w-9 rounded-full object-cover shadow-[0_8px_22px_rgba(255,59,95,0.2)]"
            />
            <div>
              <h1 className="text-base font-bold">AnimeUta</h1>
              <p className="text-xs text-zinc-500">{t('nav.tagline')}</p>
            </div>
          </div>

          <nav className="space-y-1 px-3">
            <NavLink className={navLinkClass} to="/">
              <Compass size={18} />
              {t('nav.home')}
            </NavLink>
            <NavLink className={navLinkClass} to="/online"><Library size={18} />{currentLanguage === 'en' ? 'Online library' : currentLanguage === 'ja' ? 'オンライン曲庫' : '在线曲库'}</NavLink>
            <NavLink className={navLinkClass} to="/study">
              <BookOpenCheck size={18} />
              {t('nav.study', { defaultValue: '日语学习' })}
            </NavLink>
          </nav>

          <div className="mt-5 border-t border-white/[0.055] px-3 pt-4">
            <p className="mb-2 px-3 text-[11px] font-semibold text-zinc-600">{t('nav.myMusic')}</p>
            <nav className="space-y-1">
              <NavLink className={navLinkClass} to="/favorites">
                <Heart size={18} />
                {t('nav.favorites')}
              </NavLink>
              <NavLink className={navLinkClass} to="/playlists">
                <ListMusic size={18} />
                {t('nav.playlists')}
              </NavLink>
              <NavLink className={navLinkClass} to="/history">
                <Clock3 size={18} />
                {t('nav.history')}
              </NavLink>
              {isAdmin && (
                <>
                  <NavLink className={navLinkClass} to="/admin/songs">
                    <PencilLine size={18} />
                    {t('nav.adminMetadata')}
                  </NavLink>
                </>
              )}
              {currentUser?.role === 'owner' && (
                <NavLink className={navLinkClass} to="/admin/users">
                  <Users size={18} />
                  {t('nav.adminUsers', { defaultValue: '用户与邀请' })}
                </NavLink>
              )}
            </nav>
          </div>

          {!!playlists.data?.length && <nav className="sidebar-playlists" aria-label={t('nav.playlists')}>
            <p className="sidebar-section-label">{t('nav.playlists')}</p>
            {playlists.data.slice(0, 8).map((playlist) => <NavLink key={playlist.id} to={`/playlists/${playlist.id}`} className="sidebar-playlist">
              {playlist.coverUrl ? <img src={resolveMediaUrl(playlist.coverUrl)} alt="" loading="lazy" /> : <span className="sidebar-cover-placeholder"><ListMusic size={18} /></span>}
              <span className="min-w-0"><strong className="block truncate font-medium">{playlist.name}</strong><small>{playlist.songCount}</small></span>
            </NavLink>)}
          </nav>}
        </div>
      </aside>

      <header className="app-header fixed left-0 right-0 top-0 z-20 border-b border-white/[0.055] bg-[#101014]/94 backdrop-blur-xl md:left-[232px]">
        <div className="flex h-full min-w-0 items-center justify-between gap-2 px-4 sm:gap-4 md:px-8">
          {!primaryPage ? <button type="button" className="mobile-header-back icon-button shrink-0" aria-label={t('common.back')} onClick={goBack}><ArrowLeft size={19} /></button> : <NavLink className="h-9 w-9 shrink-0 overflow-hidden rounded-full sm:hidden" to="/" aria-label="AnimeUta">
            <img src="/animeuta-icon-192.png" alt="" className="h-full w-full object-cover" />
          </NavLink>}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {pathname !== '/' && <button type="button" className="header-back icon-button" aria-label={t('common.back')} title={t('common.back')} onClick={goBack}><ArrowLeft size={19} /></button>}
            <span className="truncate text-sm font-medium text-zinc-300">{pageTitle}</span>
          </div>

          <div className="flex min-w-0 shrink-0 items-center gap-2 sm:gap-3">
            <NavLink to="/clients" title="下载客户端" aria-label="下载客户端" className="flex h-9 items-center gap-2 rounded-md px-2 text-zinc-300 hover:bg-white/10"><Download size={18} /><span className="hidden text-sm lg:inline">下载客户端</span></NavLink>
            <select
              aria-label={t('nav.language')}
              className="h-9 w-[7.25rem] rounded-md border border-white/[0.08] bg-white/[0.05] px-2 text-sm text-zinc-200 outline-none sm:w-auto sm:max-w-[9rem]"
              value={currentLanguage}
              onChange={(event) => {
                void i18n.changeLanguage(event.target.value)
              }}
            >
              <option value="en">{t('common.languages.en')}</option>
              <option value="zh">{t('common.languages.zh')}</option>
              <option value="ja">{t('common.languages.ja')}</option>
            </select>

            {isAuthenticated ? (
              <>
                <NavLink
                  aria-label={t('nav.account')}
                  className="flex h-11 items-center gap-2 rounded-md px-2 text-sm text-zinc-300 hover:bg-white/[0.055] hover:text-white sm:px-3"
                  to="/account"
                >
                  {currentUser?.profile?.avatarUrl ? (
                    <img
                      src={resolveMediaUrl(currentUser.profile.avatarUrl)}
                      alt={currentUser.profile.displayName ?? currentUser.email}
                      className="h-6 w-6 rounded-full object-cover"
                    />
                  ) : (
                    <UserCircle size={16} />
                  )}
                  <span className="hidden max-w-32 truncate sm:inline">{currentUser?.profile?.displayName ?? t('nav.account')}</span>
                </NavLink>
                <button
                  type="button"
                  className="hidden h-9 items-center gap-2 rounded-md px-3 text-sm text-zinc-400 hover:bg-white/[0.06] hover:text-white sm:flex"
                  onClick={() => {
                    void clearAuth()
                  }}
                >
                  <LogOut size={16} />
                  <span className="hidden sm:inline">{t('nav.logout')}</span>
                </button>
              </>
            ) : (
              <NavLink className="rounded-md bg-[#ff3b5f] px-4 py-2 text-sm font-semibold text-white" to="/login">
                {t('nav.login')}
              </NavLink>
            )}
          </div>
        </div>
      </header>

      <nav aria-label={t('nav.myMusic')} className="mobile-bottom-nav fixed left-0 right-0 z-30 grid grid-cols-5 border-t border-white/[0.08] bg-[#19191f] px-2 md:hidden">
        <NavLink className={mobileNavLinkClass} to="/" aria-label={t('nav.home')} title={t('nav.home')}>
          <Compass size={18} />
          <span>{t('ux.tabs.home')}</span>
        </NavLink>
        <NavLink className={mobileNavLinkClass} to="/favorites" aria-label={t('nav.favorites')} title={t('nav.favorites')}>
          <Heart size={18} />
          <span>{t('ux.tabs.favorites')}</span>
        </NavLink>
        <NavLink className={mobileNavLinkClass} to="/study" aria-label={t('nav.study')} title={t('nav.study')}>
          <BookOpenCheck size={18} />
          <span>{t('ux.tabs.study')}</span>
        </NavLink>
        <NavLink className={mobileNavLinkClass} to="/playlists" aria-label={t('nav.playlists')} title={t('nav.playlists')}>
          <ListMusic size={18} />
          <span>{t('ux.tabs.playlists')}</span>
        </NavLink>
        <NavLink className={mobileNavLinkClass} to="/account" aria-label={t('nav.account')} title={t('nav.account')}>
          <UserCircle size={18} />
          <span>{t('ux.tabs.account')}</span>
        </NavLink>
      </nav>
    </>
  )
}
