import { useTranslation } from 'react-i18next'

export default function HomePage() {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">{t('nav.home')}</h2>
      <p>Welcome to AnimeUta!</p>
    </div>
  )
}
