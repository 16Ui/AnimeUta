import { useTranslation } from 'react-i18next'

export default function LoginPage() {
  const { t } = useTranslation()
  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="bg-gray-900 p-8 rounded-lg shadow-xl w-full max-w-sm">
        <h2 className="text-2xl font-bold mb-6 text-center text-primary">{t('nav.login')}</h2>
        <button className="w-full bg-primary hover:bg-primary-dark text-white p-2 rounded">
          Login (Mock)
        </button>
      </div>
    </div>
  )
}
