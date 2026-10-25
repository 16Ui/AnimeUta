import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, Monitor, Smartphone } from 'lucide-react'
import { releaseOrigin, type ClientRelease } from '../lib/clientUpdates'

export default function DownloadsPage() {
  const [releases, setReleases] = useState<Partial<Record<'windows' | 'android', ClientRelease>>>({})
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12000)
    fetch(`${releaseOrigin}/updates.json`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('manifest')
        const data = await response.json()
        for (const platform of ['windows', 'android']) {
          const value = data[platform]
          if (!value || !/^\d+\.\d+\.\d+$/.test(value.version) || !Number.isFinite(value.size) || value.size <= 0) throw new Error('manifest')
        }
        setReleases(data)
      }).catch(() => setFailed(true)).finally(() => window.clearTimeout(timeout))
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [])
  return <main className="min-h-screen bg-[#101014] px-5 py-8 text-zinc-100 sm:px-10">
    <div className="mx-auto max-w-4xl">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"><ArrowLeft size={17} />返回 AnimeUta</Link>
      <header className="flex items-center gap-4 border-b border-white/10 py-8">
        <img src="/animeuta-icon-192.png" alt="" className="h-16 w-16 rounded-lg" />
        <div><h1 className="text-2xl font-semibold">AnimeUta 客户端</h1><p className="mt-2 text-sm text-zinc-400">使用同一账号，访问同一云端曲库。</p></div>
      </header>
      <div className="grid gap-8 py-8 md:grid-cols-2">
        {(['windows', 'android'] as const).map(platform => {
          const windows = platform === 'windows', release = releases[platform]
          const Icon = windows ? Monitor : Smartphone
          return <section key={platform} className="min-w-0">
            <Icon size={28} className={windows ? 'text-rose-400' : 'text-emerald-300'} />
            <h2 className="mt-4 text-xl font-semibold">{windows ? 'Windows 电脑端' : 'Android 手机端'}</h2>
            <p className="mt-2 text-sm text-zinc-400">{windows ? 'Windows 10 / 11 · 64 位' : 'Android 7.0 及以上 · APK'}</p>
            <p className="my-4 min-h-5 text-sm text-zinc-500">{release ? `v${release.version} · ${(release.size / 1048576).toFixed(1)} MB` : failed ? '版本信息暂不可用，仍可下载' : '正在读取版本…'}</p>
            <a className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#ff3b5f] px-5 font-medium text-white hover:bg-[#ef3154]" href={`${releaseOrigin}/downloads/${platform}/${windows ? 'AnimeUta-Setup.exe' : 'AnimeUta.apk'}`}><Download size={18} />{windows ? '下载安装程序' : '下载 APK'}</a>
            <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm leading-6 text-zinc-300">
              {(windows ? ['打开安装程序，按中文向导选择安装位置。', '缺少 WebView2 时，安装程序会联网补齐运行环境。', '安装完成后启动，使用已有 AnimeUta 账号登录。'] : ['在 Android 手机浏览器中打开此页并下载。', '打开 APK；如系统询问，仅允许当前浏览器安装此应用。', '完成安装后关闭该授权，使用已有账号登录。']).map(step => <li key={step}>{step}</li>)}
            </ol>
            <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-6 text-zinc-500">{windows ? '安装包尚未进行商业代码签名，Windows 可能显示发布者未知。请核对下载来源，不要关闭系统安全防护。' : '当前提供自用测试签名包，非应用商店发行版。更新请使用同来源安装包；不要先卸载，以免清除设备上的设置。'}</p>
          </section>
        })}
      </div>
      <footer className="border-t border-white/10 py-5 text-sm text-zinc-400">已有客户端？可在账户页面检查更新。网页端无需安装。</footer>
    </div>
  </main>
}
