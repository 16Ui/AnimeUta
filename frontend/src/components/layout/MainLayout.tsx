import { Outlet } from 'react-router-dom'
import GlobalPlayer from './GlobalPlayer'
import Navbar from './Navbar'

export default function MainLayout() {
  return (
    <div className="flex flex-col min-h-screen bg-black text-white">
      <Navbar />
      <main className="flex-1 overflow-y-auto pb-24">
        <Outlet />
      </main>
      <GlobalPlayer />
    </div>
  )
}
