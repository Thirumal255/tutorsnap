import { useState, useEffect } from 'react'

/**
 * #28 PWA — shows a bottom-sheet install banner when the browser fires
 * `beforeinstallprompt`. Dismissed state is persisted in localStorage so it
 * doesn't come back on every page load.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [visible, setVisible] = useState(false)
  const [dismissed] = useState(
    () => localStorage.getItem('pwa_install_dismissed') === '1'
  )

  useEffect(() => {
    if (dismissed) return

    const handler = (e) => {
      e.preventDefault()          // stop Chrome mini-bar
      setDeferredPrompt(e)
      setVisible(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [dismissed])

  // Hide once the app is installed
  useEffect(() => {
    const handler = () => setVisible(false)
    window.addEventListener('appinstalled', handler)
    return () => window.removeEventListener('appinstalled', handler)
  }, [])

  if (!visible || dismissed) return null

  async function handleInstall() {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') setVisible(false)
    setDeferredPrompt(null)
  }

  function handleDismiss() {
    setVisible(false)
    localStorage.setItem('pwa_install_dismissed', '1')
  }

  return (
    <div className="fixed bottom-20 md:bottom-6 left-3 right-3 md:left-auto md:right-6 md:w-80 z-50 animate-bounce-in">
      <div className="blox-card border border-[#00A2FF]/40 bg-[#16213E] p-4 shadow-2xl flex items-center gap-3">
        {/* Icon */}
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-[#00A2FF] to-[#6C63FF] flex items-center justify-center text-2xl flex-shrink-0">
          📱
        </div>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p className="font-fredoka font-bold text-white text-sm leading-tight">
            Install StudyBlox
          </p>
          <p className="text-xs text-[#8892B0] mt-0.5 leading-tight">
            Add to your home screen for quick access
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <button
            onClick={handleInstall}
            className="text-xs font-semibold font-nunito bg-[#00A2FF] hover:bg-[#0088DD] text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            Install
          </button>
          <button
            onClick={handleDismiss}
            className="text-[10px] text-[#8892B0] hover:text-white transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
