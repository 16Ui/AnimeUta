import { useTranslation } from 'react-i18next'

export default function FavoritesPage() {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">{t('nav.favorites')}</h2>
      <p>Your favorite songs will appear here.</p>
    </div>
  )
}
