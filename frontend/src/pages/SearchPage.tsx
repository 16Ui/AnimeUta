import { useTranslation } from 'react-i18next'

export default function SearchPage() {
  const { t } = useTranslation()
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">{t('nav.search')}</h2>
      <input 
        type="text" 
        className="bg-gray-800 text-white p-2 rounded w-full max-w-md" 
        placeholder="Search for songs, artists, works..." 
      />
    </div>
  )
}
