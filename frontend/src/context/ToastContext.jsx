import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastContext = createContext(null)

let _id = 0

/**
 * Global toast system.
 * Usage:  const { toast } = useToast()
 *         toast.success('Saved!')
 *         toast.error('Something went wrong')
 *         toast.info('FYI…')
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const add = useCallback((message, type = 'info', duration = 3500) => {
    const id = ++_id
    setToasts(prev => [...prev.slice(-4), { id, message, type }]) // keep max 5
    setTimeout(() => remove(id), duration)
    return id
  }, [remove])

  const toast = {
    success: (msg, dur) => add(msg, 'success', dur),
    error:   (msg, dur) => add(msg, 'error',   dur ?? 5000),
    info:    (msg, dur) => add(msg, 'info',     dur),
    warn:    (msg, dur) => add(msg, 'warn',     dur),
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={remove} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ── Toast UI ──────────────────────────────────────────────────────────────────
const TYPE_STYLES = {
  success: { bg: 'bg-[#00CC88]',  icon: '✓', ring: 'ring-[#00CC88]/30' },
  error:   { bg: 'bg-[#FF3333]',  icon: '✕', ring: 'ring-[#FF3333]/30' },
  warn:    { bg: 'bg-[#FFB347]',  icon: '⚠', ring: 'ring-[#FFB347]/30' },
  info:    { bg: 'bg-[#00A2FF]',  icon: 'ℹ', ring: 'ring-[#00A2FF]/30' },
}

function ToastContainer({ toasts, onRemove }) {
  if (!toasts.length) return null
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => {
        const s = TYPE_STYLES[t.type] || TYPE_STYLES.info
        return (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl ring-2 ${s.ring} bg-[#16213E] min-w-[220px] max-w-[340px] animate-bounce-in`}
          >
            <span className={`w-6 h-6 rounded-full ${s.bg} flex items-center justify-center text-white text-sm font-bold flex-shrink-0`}>
              {s.icon}
            </span>
            <span className="text-sm text-white font-nunito font-semibold flex-1 leading-snug">
              {t.message}
            </span>
            <button
              onClick={() => onRemove(t.id)}
              className="text-[#8892B0] hover:text-white text-lg leading-none flex-shrink-0 transition-colors"
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
