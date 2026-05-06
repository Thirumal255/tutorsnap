import { useEffect, useState } from 'react'
import { getSettings, updateSettings } from '../../api/client'

export default function AdminSettings() {
  const [settings, setSettings] = useState({})
  const [form, setForm] = useState({})
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSettings().then(r => {
      setSettings(r.data)
      setForm(r.data)
    }).finally(() => setLoading(false))
  }, [])

  function handleChange(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
    setSaved(false)
  }

  async function handleSave() {
    try {
      const r = await updateSettings(form)
      setSettings(r.data)
      setForm(r.data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      alert(e.response?.data?.detail || 'Failed to save')
    }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-lg">
      <h2 className="text-xl font-bold text-gray-800 mb-6">Settings</h2>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max questions per session
          </label>
          <input
            type="number" min={5} max={50}
            value={form.max_questions_per_session || ''}
            onChange={e => handleChange('max_questions_per_session', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Max hint tiers
          </label>
          <input
            type="number" min={3} max={7}
            value={form.max_hint_tiers || ''}
            onChange={e => handleChange('max_hint_tiers', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Session timeout (minutes)
          </label>
          <input
            type="number" min={10} max={60}
            value={form.session_timeout_minutes || ''}
            onChange={e => handleChange('session_timeout_minutes', e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
          />
        </div>

        <div className="flex items-center gap-4">
          <button onClick={handleSave}
            className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
            Save Settings
          </button>
          {saved && <span className="text-sm text-green-600 font-medium">Saved!</span>}
        </div>

        <p className="text-xs text-gray-400">Changes take effect for new sessions immediately.</p>
      </div>
    </div>
  )
}
