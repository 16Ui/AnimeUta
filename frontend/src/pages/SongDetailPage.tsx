import { useParams } from 'react-router-dom'

export default function SongDetailPage() {
  const { id } = useParams()
  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-4">Song Details</h2>
      <p>Showing info for song ID: {id}</p>
    </div>
  )
}
