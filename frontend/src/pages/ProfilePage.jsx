import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { updateProfile, uploadProfileAvatar } from '../api/client'
import { AVATAR_PRESETS } from '../components/UserAvatar'

// Ordered for the grid display
const PRESET_KEYS = [
  'cat', 'dog', 'fox', 'panda',
  'lion', 'dolphin', 'owl', 'frog',
  'tiger', 'butterfly', 'penguin', 'unicorn',
  'dragon', 'wizard', 'eagle', 'robot',
  'star', 'rocket', 'palette', 'theatre',
]

export default function ProfilePage() {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState(user?.name || '')
  // null = use Google photo / whatever avatar_url is; string = chosen preset key
  const [selectedPreset, setSelectedPreset] = useState(user?.avatar_preset || null)
  const [previewUrl, setPreviewUrl] = useState(null)       // blob URL for local preview
  const [pendingFile, setPendingFile]   = useState(null)   // File object to upload
  const [tab, setTab]   = useState('preset')               // 'preset' | 'upload'
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const fileRef = useRef()

  // What to show in the big preview at the top
  const previewEmoji = selectedPreset ? AVATAR_PRESETS[selectedPreset] : null
  const previewImage = previewUrl || (!selectedPreset ? user?.avatar_url : null)

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be under 5 MB')
      return
    }
    setError(null)
    setPendingFile(file)
    setSelectedPreset(null)
    setPreviewUrl(URL.createObjectURL(file))
  }

  function handlePresetPick(key) {
    setSelectedPreset(key)
    setPreviewUrl(null)
    setPendingFile(null)
    setError(null)
  }

  function handleGooglePhoto() {
    setSelectedPreset(null)
    setPreviewUrl(null)
    setPendingFile(null)
  }

  async function handleSave() {
    if (!name.trim()) { setError('Name cannot be empty'); return }
    setSaving(true)
    setError(null)
    try {
      // 1. Upload custom photo first if pending
      if (pendingFile) {
        const fd = new FormData()
        fd.append('file', pendingFile)
        await uploadProfileAvatar(fd)
        // backend clears avatar_preset automatically on upload
      }

      // 2. Save name + preset (empty string clears it)
      await updateProfile({
        display_name: name.trim(),
        // Only send avatar_preset when no custom upload (upload sets it server-side)
        ...(!pendingFile && { avatar_preset: selectedPreset || '' }),
      })

      // 3. Refresh user in auth context so layouts update immediately
      await refreshUser()
      navigate(-1)
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F23]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-[#16213E] border-b border-[#2D2B5A] px-6 py-4 flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="text-[#8892B0] hover:text-white text-sm font-nunito transition-all"
        >
          ← Back
        </button>
        <h1 className="font-fredoka font-bold text-white text-lg">Edit Profile</h1>
        <div className="w-14" />
      </div>

      <div className="max-w-md mx-auto px-5 py-6 space-y-5">

        {/* ── Current avatar preview ──────────────────────────── */}
        <div className="flex flex-col items-center gap-2 py-2">
          {previewImage ? (
            <img
              src={previewImage}
              alt=""
              className="w-24 h-24 rounded-2xl object-cover border-2 border-[#00A2FF]"
            />
          ) : previewEmoji ? (
            <div className="w-24 h-24 rounded-2xl bg-[#1A1A3E] border-2 border-[#00A2FF] flex items-center justify-center text-5xl">
              {previewEmoji}
            </div>
          ) : (
            <div className="w-24 h-24 rounded-2xl bg-gradient-to-br from-[#FF6B9D] to-[#FF3333] border-2 border-[#00A2FF] flex items-center justify-center text-white font-fredoka font-bold text-4xl">
              {name?.[0]?.toUpperCase() || '?'}
            </div>
          )}
          <p className="text-[#8892B0] text-xs">Tap below to change your avatar</p>
        </div>

        {/* ── Display name ────────────────────────────────────── */}
        <div className="blox-card p-4 space-y-2">
          <label className="text-xs font-semibold text-[#8892B0] uppercase tracking-wide">
            Display Name
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={50}
            placeholder="Your name"
            className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-4 py-2.5 text-white font-nunito text-sm focus:outline-none focus:border-[#00A2FF] transition-colors"
          />
          <p className="text-[10px] text-[#4A5568]">Email ({user?.email}) is managed by Google</p>
        </div>

        {/* ── Avatar picker ────────────────────────────────────── */}
        <div className="blox-card p-4 space-y-3">
          {/* Tab switcher */}
          <div className="flex gap-2 bg-[#0F0F23] rounded-xl p-1">
            <button
              onClick={() => setTab('preset')}
              className={`flex-1 py-2 rounded-lg text-xs font-nunito font-semibold transition-all ${
                tab === 'preset'
                  ? 'bg-[#00A2FF] text-white shadow'
                  : 'text-[#8892B0] hover:text-white'
              }`}
            >
              🎭 Choose Avatar
            </button>
            <button
              onClick={() => setTab('upload')}
              className={`flex-1 py-2 rounded-lg text-xs font-nunito font-semibold transition-all ${
                tab === 'upload'
                  ? 'bg-[#00A2FF] text-white shadow'
                  : 'text-[#8892B0] hover:text-white'
              }`}
            >
              🖼️ From Gallery
            </button>
          </div>

          {/* Preset grid */}
          {tab === 'preset' && (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2">
                {PRESET_KEYS.map(key => (
                  <button
                    key={key}
                    onClick={() => handlePresetPick(key)}
                    title={key}
                    className={`h-12 rounded-xl text-2xl flex items-center justify-center transition-all ${
                      selectedPreset === key
                        ? 'bg-[#00A2FF]/20 border-2 border-[#00A2FF] scale-110'
                        : 'bg-[#0F0F23] border border-[#2D2B5A] hover:border-[#00A2FF]/50 hover:scale-105'
                    }`}
                  >
                    {AVATAR_PRESETS[key]}
                  </button>
                ))}
              </div>

              {/* Use Google photo option */}
              {user?.avatar_url && (
                <button
                  onClick={handleGooglePhoto}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                    !selectedPreset && !previewUrl
                      ? 'border-[#00A2FF] bg-[#00A2FF]/10'
                      : 'border-[#2D2B5A] hover:border-[#00A2FF]/50'
                  }`}
                >
                  <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                  <span className="text-xs font-nunito text-[#8892B0]">Use my Google profile photo</span>
                  {!selectedPreset && !previewUrl && (
                    <span className="ml-auto text-[#00A2FF] text-xs">✓</span>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Upload from gallery */}
          {tab === 'upload' && (
            <div className="space-y-3">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileRef.current?.click()}
                className="w-full py-7 rounded-xl border-2 border-dashed border-[#2D2B5A] hover:border-[#00A2FF]/60 text-[#8892B0] hover:text-white transition-all font-nunito text-sm flex flex-col items-center gap-2"
              >
                {pendingFile ? (
                  <>
                    <span className="text-3xl">✅</span>
                    <span className="text-xs text-[#00CC88] truncate max-w-full px-4">{pendingFile.name}</span>
                    <span className="text-xs">Tap to choose a different photo</span>
                  </>
                ) : (
                  <>
                    <span className="text-3xl">🖼️</span>
                    <span>Tap to choose from gallery</span>
                    <span className="text-xs text-[#4A5568]">JPG · PNG · WebP · max 5 MB</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ── Error ──────────────────────────────────────────────── */}
        {error && (
          <p className="text-[#FF6B6B] text-sm text-center font-nunito">{error}</p>
        )}

        {/* ── Save button ─────────────────────────────────────── */}
        <button
          onClick={handleSave}
          disabled={saving || !name.trim()}
          className="w-full btn-blox-primary py-4 text-base font-fredoka font-bold disabled:opacity-50"
        >
          {saving ? '⏳ Saving…' : 'Save Changes'}
        </button>

      </div>
    </div>
  )
}
