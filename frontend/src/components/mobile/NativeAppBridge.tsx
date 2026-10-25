import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor, SystemBars, SystemBarsStyle, type PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

const keyboardClass = 'native-keyboard-open'

export default function NativeAppBridge() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let disposed = false
    const handles: PluginListenerHandle[] = []
    const remember = async (pending: Promise<PluginListenerHandle>) => {
      const handle = await pending
      if (disposed) await handle.remove()
      else handles.push(handle)
    }

    void SystemBars.setStyle({ style: SystemBarsStyle.Dark })
    void remember(App.addListener('backButton', ({ canGoBack }) => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
      const dialog = dialogs[dialogs.length - 1]
      if (dialog) {
        dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
        return
      }
      const backEvent = new Event('animeuta:back', { cancelable: true })
      if (!window.dispatchEvent(backEvent)) return
      const atRoot = window.location.pathname === '/'
      if (canGoBack && !atRoot) {
        window.history.back()
        return
      }
      void App.minimizeApp()
    }))
    void remember(Keyboard.addListener('keyboardWillShow', () => {
      document.documentElement.classList.add(keyboardClass)
    }))
    void remember(Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.classList.remove(keyboardClass)
    }))

    return () => {
      disposed = true
      document.documentElement.classList.remove(keyboardClass)
      for (const handle of handles.splice(0)) void handle.remove()
    }
  }, [])

  return null
}
