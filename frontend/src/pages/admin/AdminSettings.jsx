import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../../api/client'
import { useToast } from '../../context/ToastContext'

const SETTINGS_META = [
  {
    key: 'max_questions_per_session',
    label: 'Max questions per session',
    desc: 'How many questions are asked before a session auto-completes.',
    icon: '❓',
    type: 'number',
    min: 5, max: 50,
  },
  {
    key: 'max_hint_tiers',
    label: 'Max hint tiers',
    desc: 'Number of progressive hint levels before the answer is revealed.',
    icon: '💡',
    type: 'number',
    min: 3, max: 7,
  },
  {
    key: 'session_timeout_minutes',
    label: 'Session timeout (minutes)',
    desc: 'Inactive sessions are auto-ended after this many minutes.',
    icon: '⏱️',
    type: 'number',
    min: 10, max: 60,
  },
]

export default function AdminSettings() {
  const { toast } = useToast()
  const [form, setForm] = useState({})
  const [original, setOriginal] = useState({})
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSettings().then(r => {
      setForm(r.data)
      setOriginal(r.data)
    }).finally(() => setLoading(false))
  }, [])

  function handleChange(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  function isDirty() {
    return SETTINGS_META.some(s => String(form[s.key]) !== String(original[s.key]))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const r = await updateSettings(form)
      setOriginal(r.data)
      setForm(r.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      toast.success('Settings saved!')
    } catch (e) {
      toast.error(e.response?.data?.detail || 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setForm(original)
    setSaved(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <div className="text-4xl animate-bounce mb-3">⚙️</div>
        <p className="text-[#8892B0]">Loading settings…</p>
      </div>
    </div>
  )

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-fredoka font-bold text-white">⚙️ Settings</h1>
        <p className="text-[#8892B0] text-sm mt-0.5">
          Platform configuration — changes apply to new sessions immediately
        </p>
      </div>

      {/* Settings cards */}
      <div className="space-y-3">
        {SETTINGS_META.map(({ key, label, desc, icon, type, min, max }) => {
          const changed = String(form[key]) !== String(original[key])
          return (
            <div key={key} className={`blox-card p-5 transition-all ${
              changed ? 'border-[#00A2FF]/50' : ''
            }`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5">{icon}</span>
                  <div>
                    <p className="font-nunito font-semibold text-white text-sm">{label}</p>
                    <p className="text-xs text-[#8892B0] mt-0.5">{desc}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type={type}
                    min={min}
                    max={max}
                    value={form[key] ?? ''}
                    onChange={e => handleChange(key, e.target.value)}
                    className="w-20 bg-[#0F0F23] border border-[#2D2B5A] focus:border-[#00A2FF] text-white text-sm rounded-xl px-3 py-2 text-center font-fredoka font-bold focus:outline-none transition-colors"
                  />
                  {changed && (
                    <span className="text-[10px] text-[#00A2FF] font-semibold">modified</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2 ml-9">
                <span className="text-[10px] text-[#8892B0]">Min: {min}</span>
                <div className="flex-1 h-px bg-[#2D2B5A]" />
                <span className="text-[10px] text-[#8892B0]">Max: {max}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Save bar */}
      <div className="blox-card p-4 flex items-center justify-between gap-4">
        <div>
          {saved && (
            <span className="text-sm text-[#00CC88] font-semibold font-nunito">
              ✓ Settings saved successfully
            </span>
          )}
          {!saved && isDirty() && (
            <span className="text-sm text-[#FFD700] font-semibold font-nunito">
              ⚡ You have unsaved changes
            </span>
          )}
          {!saved && !isDirty() && (
            <span className="text-sm text-[#8892B0] font-nunito">No changes</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isDirty() && (
            <button
              onClick={handleReset}
              className="text-sm text-[#8892B0] hover:text-white font-nunito font-semibold transition-colors"
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty()}
            className="btn-blox-primary text-sm py-2.5 px-6 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? '⚡ Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>

      {/* Info note */}
      <p className="text-xs text-[#8892B0] px-1">
        💡 Settings are stored in the database and override hardcoded defaults. Restart is not required.
      </p>
    </div>
  )
}
