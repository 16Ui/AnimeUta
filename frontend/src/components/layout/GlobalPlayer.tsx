import { usePlayerStore } from '../../store/usePlayerStore'
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react'

export default function GlobalPlayer() {
  const { currentSong, isPlaying, togglePlay, volume, setVolume } = usePlayerStore()

  if (!currentSong) {
    return (
      <div className="fixed bottom-0 left-0 right-0 h-24 bg-gray-900 border-t border-gray-800 flex items-center justify-center px-6 text-gray-500 italic">
        Select a song to start playing...
      </div>
    )
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 h-24 bg-gray-900 border-t border-gray-800 flex items-center px-6 justify-between">
      {/* Song Info */}
      <div className="flex items-center w-1/3">
        {currentSong.coverUrl && (
          <img src={currentSong.coverUrl} alt={currentSong.title} className="w-12 h-12 rounded mr-4" />
        )}
        <div>
          <h4 className="font-bold text-sm truncate">{currentSong.title}</h4>
          <p className="text-xs text-gray-400 truncate">{currentSong.artist}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col items-center w-1/3">
        <div className="flex items-center space-x-6 mb-2">
          <button className="text-gray-400 hover:text-white"><SkipBack size={20} /></button>
          <button 
            onClick={togglePlay}
            className="w-10 h-10 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition"
          >
            {isPlaying ? <Pause size={24} fill="black" /> : <Play size={24} fill="black" className="ml-1" />}
          </button>
          <button className="text-gray-400 hover:text-white"><SkipForward size={20} /></button>
        </div>
        <div className="w-full max-w-md h-1 bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-primary w-1/3"></div>
        </div>
      </div>

      {/* Volume / Additional */}
      <div className="flex items-center justify-end w-1/3 space-x-4">
        <div className="flex items-center space-x-2">
          <Volume2 size={20} className="text-gray-400" />
          <input 
            type="range" 
            min="0" 
            max="1" 
            step="0.01" 
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-24 accent-primary" 
          />
        </div>
      </div>
    </div>
  )
}
