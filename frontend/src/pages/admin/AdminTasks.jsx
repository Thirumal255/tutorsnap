import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  getAdminTasks, getAdminTasksSummary,
  createAdminTask, updateAdminTask, deleteAdminTask,
  addTaskExpense, deleteTaskExpense,
  getFinanceAccounts, getBudgetItems, updateBudgetItem,
} from '../../api/client'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  not_started: { label: 'Not Started',      color: 'bg-[#2D2B5A] text-[#8892B0]',    dot: 'bg-[#8892B0]',    row: '' },
  in_progress:  { label: 'In Progress',      color: 'bg-[#00A2FF]/15 text-[#00A2FF]', dot: 'bg-[#00A2FF]',    row: 'border-l-2 border-l-[#00A2FF]/60' },
  completed:    { label: 'Completed',         color: 'bg-[#00CC88]/15 text-[#00CC88]', dot: 'bg-[#00CC88]',    row: 'opacity-70' },
  on_hold:      { label: 'Delayed / Blocked', color: 'bg-[#FFB347]/15 text-[#FFB347]', dot: 'bg-[#FFB347]',    row: 'border-l-2 border-l-[#FFB347]/60' },
}
const STATUSES = Object.keys(STATUS_META)

const PHASE_ORDER = [
  'Pre-Construction', 'Construction', 'Pre-Plantation',
  'Plantation & Crop Cycle 1', 'B2B & Market Setup', 'Harvest & Sales',
]

const KEY_DATES = [
  { label: 'Project start (bank sanction)',  date: '2026-08-17' },
  { label: 'NHB approval target',            date: '2026-10-15' },
  { label: 'Construction start',             date: '2026-11-01' },
  { label: 'Construction end (target)',       date: '2027-02-28' },
  { label: 'Plantation start',               date: '2027-03-01' },
  { label: 'First harvest target',           date: '2027-05-01' },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmtINR(v) {
  if (!v && v !== 0) return '—'
  if (v >= 1_00_00_000) return `₹${(v / 1_00_00_000).toFixed(2)} Cr`
  if (v >= 1_00_000)    return `₹${(v / 1_00_000).toFixed(2)} L`
  return `₹${Number(v).toLocaleString('en-IN')}`
}

function fmt(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShort(d) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

function daysRemaining(endDate, status) {
  if (status === 'completed') return null
  if (!endDate) return null
  const diff = Math.ceil((new Date(endDate + 'T00:00:00') - new Date(new Date().toDateString())) / 86400000)
  return diff
}

function isOverdue(task) {
  if (!task.end_date || task.status === 'completed') return false
  return new Date(task.end_date) < new Date(new Date().toDateString())
}

// ── Small reusable components ──────────────────────────────────────────────

function StatusBadge({ status, onClick }) {
  const m = STATUS_META[status] || STATUS_META.not_started
  return (
    <span
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold select-none ${m.color} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${m.dot}`} />
      {m.label}
    </span>
  )
}

function DaysChip({ days }) {
  if (days === null) return <span className="text-xs text-[#00CC88] font-semibold">Done</span>
  if (days < 0) return <span className="text-xs font-bold text-[#FF3333] bg-[#FF3333]/10 px-2 py-0.5 rounded-full">{Math.abs(days)}d overdue</span>
  if (days === 0) return <span className="text-xs font-bold text-[#FFB347]">Due today</span>
  if (days <= 7) return <span className="text-xs font-bold text-[#FFB347]">{days}d left</span>
  return <span className="text-xs text-[#8892B0]">{days}d</span>
}

function KpiCard({ icon, label, value, sub, accent }) {
  return (
    <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-4 flex flex-col gap-1">
      <span className="text-xl">{icon}</span>
      <p className="text-[#8892B0] text-xs font-semibold mt-1">{label}</p>
      <p className={`text-2xl font-fredoka font-bold ${accent || 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#8892B0] text-xs">{sub}</p>}
    </div>
  )
}

// ── Task form modal ─────────────────────────────────────────────────────────

function TaskModal({ task, onSave, onClose }) {
  const isEdit = !!task?.id
  const [form, setForm] = useState({
    title:             task?.title || '',
    category:          task?.category || PHASE_ORDER[0],
    owner:             task?.owner || '',
    status:            task?.status || 'not_started',
    start_date:        task?.start_date || '',
    end_date:          task?.end_date || '',
    actual_start_date: task?.actual_start_date || '',
    notes:             task?.notes || '',
    priority:          task?.priority || 'medium',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.title.trim()) return setError('Title is required')
    setSaving(true); setError('')
    try {
      const payload = {
        ...form,
        title: form.title.trim(),
        owner: form.owner.trim() || null,
        notes: form.notes.trim() || null,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
        actual_start_date: form.actual_start_date || null,
        dependency_ids: [],
      }
      if (isEdit) await updateAdminTask(task.id, payload)
      else await createAdminTask(payload)
      onSave()
    } catch (e) {
      const d = e.response?.data?.detail
      setError(Array.isArray(d) ? d.map(x => x.msg).join('; ') : d || e.message)
    } finally { setSaving(false) }
  }

  const inp = 'w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]'

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-[#2D2B5A] flex items-center justify-between">
          <h3 className="text-base font-fredoka font-bold text-white">{isEdit ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl">×</button>
        </div>
        <div className="p-5 space-y-4">
          {error && <p className="text-[#FF3333] text-sm bg-[#FF3333]/10 border border-[#FF3333]/20 rounded-xl px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Task Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)} className={inp} placeholder="Task title" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Phase</label>
              <select value={form.category} onChange={e => set('category', e.target.value)} className={inp}>
                {PHASE_ORDER.map(p => <option key={p} value={p}>{p}</option>)}
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Owner</label>
              <input value={form.owner} onChange={e => set('owner', e.target.value)} className={inp} placeholder="e.g. Thirumal" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inp}>
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)} className={inp}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Planned Start</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Planned End</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} className={inp} />
            </div>
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Actual Start</label>
              <input type="date" value={form.actual_start_date} onChange={e => set('actual_start_date', e.target.value)} className={inp} />
            </div>
          </div>
          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className={`${inp} resize-none`} placeholder="Notes, blockers, decisions..." />
          </div>
        </div>
        <div className="p-5 border-t border-[#2D2B5A] flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[#8892B0] hover:text-white border border-[#2D2B5A] rounded-xl text-sm font-semibold transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-[#00A2FF] hover:bg-[#0088CC] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Task detail side panel ──────────────────────────────────────────────────

function TaskDetail({ task, allTasks, onUpdate, onClose }) {
  const [showEdit, setShowEdit] = useState(false)
  const [showExpense, setShowExpense] = useState(false)
  const [expForm, setExpForm] = useState({ amount: '', description: '', expense_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function quickStatus(status) {
    await updateAdminTask(task.id, { status }); onUpdate()
  }
  async function handleDelete() {
    if (!confirm(`Delete "${task.title}"?`)) return
    setDeleting(true)
    await deleteAdminTask(task.id); onUpdate(); onClose()
  }
  async function addExpense() {
    const amt = parseFloat(expForm.amount)
    if (!amt || amt <= 0) return
    setSaving(true)
    try {
      await addTaskExpense(task.id, { amount: amt, description: expForm.description || null, expense_date: expForm.expense_date })
      setExpForm({ amount: '', description: '', expense_date: new Date().toISOString().split('T')[0] })
      setShowExpense(false); onUpdate()
    } finally { setSaving(false) }
  }

  const days = daysRemaining(task.end_date, task.status)

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 flex items-start justify-end p-4" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl w-full max-w-md h-full max-h-[calc(100vh-2rem)] overflow-y-auto flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-[#2D2B5A] flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#8892B0] font-semibold">{task.category}</p>
                <h3 className="text-base font-fredoka font-bold text-white leading-tight mt-0.5">{task.title}</h3>
                {task.owner && <p className="text-xs text-[#8892B0] mt-0.5">Owner: <span className="text-[#00A2FF]">{task.owner}</span></p>}
              </div>
              <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl flex-shrink-0">×</button>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <StatusBadge status={task.status} />
              {days !== null && <DaysChip days={days} />}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Dates */}
            <div className="grid grid-cols-3 gap-2">
              {[['Planned Start', task.start_date], ['Planned End', task.end_date], ['Actual Start', task.actual_start_date]].map(([lbl, d]) => (
                <div key={lbl} className="bg-[#0F0F23] rounded-xl p-3">
                  <p className="text-[#8892B0] text-xs mb-1">{lbl}</p>
                  <p className="text-white text-xs font-semibold">{fmt(d)}</p>
                </div>
              ))}
            </div>

            {/* Notes */}
            {task.notes && (
              <div>
                <p className="text-xs text-[#8892B0] font-semibold mb-1">Notes</p>
                <p className="text-white text-sm whitespace-pre-wrap">{task.notes}</p>
              </div>
            )}

            {/* Quick status */}
            <div>
              <p className="text-xs text-[#8892B0] font-semibold mb-2">Quick Status</p>
              <div className="flex gap-2 flex-wrap">
                {STATUSES.map(s => (
                  <button key={s} onClick={() => quickStatus(s)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                      task.status === s ? STATUS_META[s].color : 'bg-[#0F0F23] text-[#8892B0] hover:text-white'
                    }`}>
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Expenses */}
            <div className="bg-[#0F0F23] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-fredoka font-bold text-white">
                  💰 Expenses
                  {task.total_expense > 0 && <span className="text-xs font-nunito font-normal text-[#00CC88] ml-2">{fmtINR(task.total_expense)}</span>}
                </p>
                <button onClick={() => setShowExpense(v => !v)}
                  className="text-xs px-3 py-1.5 bg-[#00CC88]/15 text-[#00CC88] hover:bg-[#00CC88]/25 rounded-xl font-semibold">
                  + Add
                </button>
              </div>
              {showExpense && (
                <div className="space-y-2 mb-3 p-3 bg-[#16213E] rounded-xl">
                  <input type="number" value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))}
                    placeholder="Amount (₹)" className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none" />
                  <input value={expForm.description} onChange={e => setExpForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Description" className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none" />
                  <input type="date" value={expForm.expense_date} onChange={e => setExpForm(f => ({ ...f, expense_date: e.target.value }))}
                    className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none" />
                  <button onClick={addExpense} disabled={saving}
                    className="w-full py-2 bg-[#00CC88] hover:bg-[#00AA77] disabled:opacity-50 text-white rounded-xl text-sm font-semibold">
                    {saving ? 'Saving…' : 'Save Expense'}
                  </button>
                </div>
              )}
              {task.expenses?.length > 0 ? (
                <div className="space-y-1.5">
                  {task.expenses.map(e => (
                    <div key={e.id} className="flex items-center gap-3 bg-[#16213E] rounded-xl px-3 py-2.5">
                      <div className="flex-1">
                        <p className="text-white text-sm font-semibold">{fmtINR(e.amount)}</p>
                        {e.description && <p className="text-[#8892B0] text-xs">{e.description}</p>}
                      </div>
                      <p className="text-[#8892B0] text-xs">{fmt(e.expense_date)}</p>
                      <button onClick={() => { deleteTaskExpense(task.id, e.id).then(onUpdate) }}
                        className="text-[#FF3333]/40 hover:text-[#FF3333] text-sm">✕</button>
                    </div>
                  ))}
                </div>
              ) : !showExpense && (
                <p className="text-[#8892B0] text-xs text-center py-2">No expenses recorded</p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-[#2D2B5A] flex gap-2 flex-shrink-0">
            <button onClick={() => setShowEdit(true)}
              className="flex-1 text-xs bg-[#00A2FF]/15 text-[#00A2FF] hover:bg-[#00A2FF]/25 rounded-xl py-2.5 font-semibold">Edit</button>
            <button onClick={handleDelete} disabled={deleting}
              className="flex-1 text-xs bg-[#FF3333]/10 text-[#FF3333] hover:bg-[#FF3333]/20 rounded-xl py-2.5 font-semibold disabled:opacity-50">
              {deleting ? '…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
      {showEdit && <TaskModal task={task} onSave={() => { setShowEdit(false); onUpdate() }} onClose={() => setShowEdit(false)} />}
    </>
  )
}

// ── Tab 1: Dashboard ────────────────────────────────────────────────────────

function DashboardTab({ summary, accounts }) {
  const byStatus = summary?.by_status || {}
  const total = summary?.total || 0
  const completed = byStatus.completed || 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  const totalPlanned = accounts.reduce((s, a) => s + (a.allocated_amount || 0), 0)
  const totalSpent   = accounts.reduce((s, a) => s + (a.paid_expenses || 0), 0)
  const variance     = totalPlanned - totalSpent

  return (
    <div className="space-y-6">
      {/* Project header */}
      <div className="bg-gradient-to-r from-[#1B3A2D] to-[#16213E] border border-[#2D6A4F]/40 rounded-2xl p-5">
        <p className="text-[#74C69D] text-xs font-semibold mb-1">2.5-ACRE NVPH POLYHOUSE PROJECT</p>
        <h3 className="text-xl font-fredoka font-bold text-white">Kurchapally, Jangaon, Telangana</h3>
        <p className="text-[#8892B0] text-sm mt-1">Vendor: Agri Blooms (INTIGROPONICS LLP)</p>
        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[#8892B0] font-semibold">OVERALL PROGRESS</span>
            <span className="text-lg font-fredoka font-bold text-[#00CC88]">{pct}%</span>
          </div>
          <div className="h-3 bg-[#0F0F23] rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-[#2D6A4F] to-[#00CC88] rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-[#8892B0] text-xs mt-1">{completed} of {total} tasks completed</p>
        </div>
      </div>

      {/* Task KPIs */}
      <div>
        <p className="text-xs text-[#8892B0] font-semibold mb-3">TASK SUMMARY</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard icon="📋" label="Total Tasks"   value={total} />
          <KpiCard icon="✅" label="Completed"      value={completed}                accent="text-[#00CC88]" />
          <KpiCard icon="🔄" label="In Progress"    value={byStatus.in_progress || 0} accent="text-[#00A2FF]" />
          <KpiCard icon="⚠️" label="Delayed/Blocked" value={byStatus.on_hold || 0}   accent="text-[#FFB347]" />
          <KpiCard icon="⏳" label="Not Started"    value={byStatus.not_started || 0} accent="text-[#8892B0]" />
        </div>
      </div>

      {/* Key Dates + Budget side-by-side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Key Dates */}
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2D2B5A] bg-[#1B3A2D]">
            <p className="text-[#74C69D] text-xs font-bold">📅 KEY DATES</p>
          </div>
          <div className="divide-y divide-[#2D2B5A]">
            {KEY_DATES.map(({ label, date }) => {
              const isPast = new Date(date) < new Date()
              return (
                <div key={label} className="flex items-center justify-between px-4 py-3">
                  <span className="text-white text-sm">{label}</span>
                  <span className={`text-sm font-semibold ${isPast ? 'text-[#8892B0]' : 'text-[#00A2FF]'}`}>
                    {fmt(date)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Budget Snapshot */}
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-[#2D2B5A] bg-[#1B3A2D]">
            <p className="text-[#74C69D] text-xs font-bold">💰 BUDGET SNAPSHOT</p>
          </div>
          <div className="p-4 space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[#2D2B5A]">
              <span className="text-[#8892B0] text-sm">Total Planned</span>
              <span className="text-white font-bold">{fmtINR(totalPlanned)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#2D2B5A]">
              <span className="text-[#8892B0] text-sm">Actual Spent</span>
              <span className="text-[#00CC88] font-bold">{fmtINR(totalSpent)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[#2D2B5A]">
              <span className="text-[#8892B0] text-sm">Variance</span>
              <span className={`font-bold ${variance < 0 ? 'text-[#FF3333]' : 'text-[#00A2FF]'}`}>{fmtINR(Math.abs(variance))}{variance < 0 ? ' over' : ' under'}</span>
            </div>
            {accounts.map(a => (
              <div key={a.id} className="flex justify-between items-center py-1">
                <span className="text-[#8892B0] text-xs">{a.name}</span>
                <div className="text-right">
                  <span className="text-white text-xs font-semibold">{fmtINR(a.live_balance ?? a.current_balance)}</span>
                  <span className="text-[#8892B0] text-xs ml-1">avail.</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Tab 2: Task Tracker ─────────────────────────────────────────────────────

function TaskTrackerTab({ tasks, onTaskClick, onStatusChange, onNewTask }) {
  const [collapsed, setCollapsed] = useState({})
  const [filterStatus, setFilterStatus] = useState('all')

  const byPhase = useMemo(() => {
    const map = {}
    PHASE_ORDER.forEach(p => { map[p] = [] })
    tasks.forEach(t => {
      const ph = PHASE_ORDER.includes(t.category) ? t.category : 'Other'
      if (!map[ph]) map[ph] = []
      map[ph].push(t)
    })
    // filter
    if (filterStatus !== 'all') {
      Object.keys(map).forEach(p => { map[p] = map[p].filter(t => t.status === filterStatus) })
    }
    return map
  }, [tasks, filterStatus])

  const toggle = p => setCollapsed(c => ({ ...c, [p]: !c[p] }))

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]">
          <option value="all">All Statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <span className="text-xs text-[#8892B0] ml-auto">{tasks.length} tasks</span>
        <button onClick={onNewTask}
          className="px-4 py-2 bg-[#00A2FF] hover:bg-[#0088CC] text-white rounded-xl text-sm font-semibold">
          + New Task
        </button>
      </div>

      {/* Phase sections */}
      {Object.entries(byPhase).filter(([phase, ts]) => ts.length > 0 || PHASE_ORDER.includes(phase)).map(([phase, phaseTasks]) => {
        const phaseAll = tasks.filter(t => (PHASE_ORDER.includes(t.category) ? t.category : 'Other') === phase)
        const done  = phaseAll.filter(t => t.status === 'completed').length
        const inProg = phaseAll.filter(t => t.status === 'in_progress').length
        const delayed = phaseAll.filter(t => t.status === 'on_hold').length

        const phaseStartDates = phaseAll.map(t => t.start_date).filter(Boolean).sort()
        const phaseEndDates   = phaseAll.map(t => t.end_date).filter(Boolean).sort()
        const phaseStart = phaseStartDates[0]
        const phaseEnd   = phaseEndDates[phaseEndDates.length - 1]

        return (
          <div key={phase} className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl overflow-hidden">
            {/* Phase header */}
            <button
              onClick={() => toggle(phase)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-[#1B3A2D] hover:bg-[#243B2D] transition-colors text-left">
              <div className="flex-1 min-w-0">
                <span className="text-[#74C69D] text-sm font-bold">{phase}</span>
                {(phaseStart || phaseEnd) && (
                  <span className="ml-3 text-[#74C69D]/55 text-xs font-mono">
                    {fmtShort(phaseStart)} – {fmtShort(phaseEnd)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-[#8892B0]">{phaseAll.length} tasks</span>
                {done > 0    && <span className="bg-[#00CC88]/15 text-[#00CC88] px-2 py-0.5 rounded-full font-semibold">{done} done</span>}
                {inProg > 0  && <span className="bg-[#00A2FF]/15 text-[#00A2FF] px-2 py-0.5 rounded-full font-semibold">{inProg} active</span>}
                {delayed > 0 && <span className="bg-[#FFB347]/15 text-[#FFB347] px-2 py-0.5 rounded-full font-semibold">{delayed} delayed</span>}
              </div>
              <span className="text-[#8892B0] text-xs">{collapsed[phase] ? '▸' : '▾'}</span>
            </button>

            {/* Table */}
            {!collapsed[phase] && phaseTasks.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2D2B5A]">
                      {['#','Task','Owner','Planned Start','Planned End','Actual Start','Status','Days Left','Notes'].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left text-xs text-[#8892B0] font-semibold whitespace-nowrap bg-[#0F0F23]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#2D2B5A]/50">
                    {phaseTasks.map((task, idx) => {
                      const days = daysRemaining(task.end_date, task.status)
                      const overdue = isOverdue(task)
                      return (
                        <tr key={task.id}
                          onClick={() => onTaskClick(task)}
                          className={`cursor-pointer hover:bg-[#1A2A4A] transition-colors ${STATUS_META[task.status]?.row || ''} ${overdue ? 'bg-[#FF3333]/5' : ''}`}>
                          <td className="px-3 py-2.5 text-[#8892B0] text-xs whitespace-nowrap">{idx + 1}</td>
                          <td className="px-3 py-2.5 text-white font-medium max-w-[240px]">
                            <span className="line-clamp-2">{task.title}</span>
                            {(task.start_date || task.end_date) && (
                              <span className="block text-[10px] text-[#8892B0] font-mono mt-0.5">
                                {fmtShort(task.start_date)} – {fmtShort(task.end_date)}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-[#8892B0] text-xs whitespace-nowrap">{task.owner || '—'}</td>
                          <td className="px-3 py-2.5 text-[#8892B0] text-xs whitespace-nowrap">{fmt(task.start_date)}</td>
                          <td className={`px-3 py-2.5 text-xs whitespace-nowrap font-semibold ${overdue ? 'text-[#FF3333]' : 'text-[#8892B0]'}`}>{fmt(task.end_date)}</td>
                          <td className="px-3 py-2.5 text-[#8892B0] text-xs whitespace-nowrap">{fmt(task.actual_start_date)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            <StatusBadge status={task.status} onClick={e => {
                              e.stopPropagation()
                              const next = STATUSES[(STATUSES.indexOf(task.status) + 1) % STATUSES.length]
                              onStatusChange(task.id, next)
                            }} />
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {task.status === 'completed'
                              ? <span className="text-xs text-[#00CC88] font-semibold">Done</span>
                              : <DaysChip days={days} />}
                          </td>
                          <td className="px-3 py-2.5 text-[#8892B0] text-xs max-w-[160px]">
                            <span className="line-clamp-1">{task.notes || ''}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {!collapsed[phase] && phaseTasks.length === 0 && (
              <p className="text-[#8892B0] text-xs px-4 py-3">No tasks match the current filter.</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Tab 3: Budget Tracker ───────────────────────────────────────────────────

function BudgetTrackerTab({ items, accounts, onRefresh }) {
  const [editId, setEditId] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [saving, setSaving] = useState(false)
  const [filterComp, setFilterComp] = useState('all')

  const components = [...new Set(items.map(i => i.component).filter(Boolean))]
  const visible = filterComp === 'all' ? items : items.filter(i => i.component === filterComp)

  const totalPlanned = visible.reduce((s, i) => s + (i.planned_amount || 0), 0)
  const totalActual  = visible.reduce((s, i) => s + (i.actual_amount || 0), 0)
  const totalVar     = totalPlanned - totalActual

  // Group by component → category
  const grouped = useMemo(() => {
    const map = {}
    visible.forEach(item => {
      const comp = item.component || 'Other'
      const cat  = item.category || 'General'
      if (!map[comp]) map[comp] = {}
      if (!map[comp][cat]) map[comp][cat] = []
      map[comp][cat].push(item)
    })
    return map
  }, [visible])

  async function saveActual(id) {
    const val = parseFloat(editVal)
    if (isNaN(val)) return setEditId(null)
    setSaving(true)
    try {
      await updateBudgetItem(id, { actual_amount: val >= 0 ? val : null })
      await onRefresh()
    } finally { setSaving(false); setEditId(null) }
  }

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]))

  return (
    <div className="space-y-4">
      {/* Toolbar + totals */}
      <div className="flex items-center gap-3 flex-wrap">
        <select value={filterComp} onChange={e => setFilterComp(e.target.value)}
          className="bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]">
          <option value="all">All Components</option>
          {components.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <p className="text-xs text-[#8892B0] ml-auto">Click Actual column to edit</p>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-xl p-3 text-center">
          <p className="text-[#8892B0] text-xs font-semibold">Total Planned</p>
          <p className="text-white font-bold text-lg mt-0.5">{fmtINR(totalPlanned)}</p>
        </div>
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-xl p-3 text-center">
          <p className="text-[#8892B0] text-xs font-semibold">Total Actual</p>
          <p className="text-[#00CC88] font-bold text-lg mt-0.5">{fmtINR(totalActual)}</p>
        </div>
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-xl p-3 text-center">
          <p className="text-[#8892B0] text-xs font-semibold">Variance</p>
          <p className={`font-bold text-lg mt-0.5 ${totalVar < 0 ? 'text-[#FF3333]' : 'text-[#00A2FF]'}`}>{fmtINR(Math.abs(totalVar))}</p>
          <p className="text-[#8892B0] text-xs">{totalVar < 0 ? 'over budget' : 'under budget'}</p>
        </div>
      </div>

      {/* Table per component */}
      {Object.entries(grouped).map(([comp, cats]) => {
        const compPlanned = Object.values(cats).flat().reduce((s, i) => s + (i.planned_amount || 0), 0)
        const compActual  = Object.values(cats).flat().reduce((s, i) => s + (i.actual_amount || 0), 0)
        return (
          <div key={comp} className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl overflow-hidden">
            {/* Component header */}
            <div className="flex items-center justify-between px-4 py-3 bg-[#1B3A2D] border-b border-[#2D2B5A]">
              <span className="text-[#74C69D] font-bold text-sm">{comp}</span>
              <div className="flex gap-4 text-xs">
                <span className="text-[#8892B0]">Planned: <span className="text-white font-semibold">{fmtINR(compPlanned)}</span></span>
                <span className="text-[#8892B0]">Actual: <span className="text-[#00CC88] font-semibold">{fmtINR(compActual)}</span></span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#2D2B5A]">
                    {['Category','Sub-Category','Line Item','Date','Planned (Rs.)','Actual (Rs.)','Variance','Account','Notes'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs text-[#8892B0] font-semibold whitespace-nowrap bg-[#0F0F23]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2D2B5A]/40">
                  {Object.entries(cats).flatMap(([cat, catItems]) =>
                    catItems.map((item, idx) => {
                      const variance = (item.planned_amount || 0) - (item.actual_amount || 0)
                      const editing = editId === item.id
                      return (
                        <tr key={item.id} className="hover:bg-[#1A2A4A] transition-colors">
                          <td className="px-3 py-2 text-[#8892B0] text-xs whitespace-nowrap">{idx === 0 ? cat : ''}</td>
                          <td className="px-3 py-2 text-[#8892B0] text-xs whitespace-nowrap">{item.sub_category || '—'}</td>
                          <td className="px-3 py-2 text-white text-xs max-w-[200px]"><span className="line-clamp-2">{item.name}</span></td>
                          <td className="px-3 py-2 text-[#8892B0] text-xs whitespace-nowrap">{fmt(item.planned_date)}</td>
                          <td className="px-3 py-2 text-white text-xs font-semibold text-right whitespace-nowrap">
                            {fmtINR(item.planned_amount)}
                          </td>
                          <td className="px-3 py-2 text-xs text-right whitespace-nowrap">
                            {editing ? (
                              <input
                                autoFocus
                                type="number"
                                value={editVal}
                                onChange={e => setEditVal(e.target.value)}
                                onBlur={() => saveActual(item.id)}
                                onKeyDown={e => { if (e.key === 'Enter') saveActual(item.id); if (e.key === 'Escape') setEditId(null) }}
                                className="w-28 bg-[#0F0F23] border border-[#00A2FF] rounded-lg px-2 py-1 text-white text-xs focus:outline-none"
                                disabled={saving}
                              />
                            ) : (
                              <span
                                onClick={() => { setEditId(item.id); setEditVal(item.actual_amount != null ? String(item.actual_amount) : '') }}
                                className={`cursor-pointer px-2 py-0.5 rounded hover:bg-[#00A2FF]/10 ${item.actual_amount != null ? 'text-[#00CC88] font-semibold' : 'text-[#2D2B5A]'}`}>
                                {item.actual_amount != null ? fmtINR(item.actual_amount) : '— click to enter'}
                              </span>
                            )}
                          </td>
                          <td className={`px-3 py-2 text-xs font-semibold text-right whitespace-nowrap ${
                            item.actual_amount == null ? 'text-[#2D2B5A]' : variance < 0 ? 'text-[#FF3333]' : 'text-[#00A2FF]'
                          }`}>
                            {item.actual_amount != null ? fmtINR(Math.abs(variance)) : '—'}
                          </td>
                          <td className="px-3 py-2 text-[#8892B0] text-xs whitespace-nowrap">
                            {item.account_name || (item.account_id ? accountMap[item.account_id] : '—')}
                          </td>
                          <td className="px-3 py-2 text-[#8892B0] text-xs max-w-[160px]">
                            <span className="line-clamp-1">{item.notes || ''}</span>
                          </td>
                        </tr>
                      )
                    })
                  )}
                  {/* Category subtotal row */}
                  {Object.entries(cats).map(([cat, catItems]) => {
                    const cp = catItems.reduce((s, i) => s + (i.planned_amount || 0), 0)
                    const ca = catItems.reduce((s, i) => s + (i.actual_amount || 0), 0)
                    if (catItems.length <= 1) return null
                    return (
                      <tr key={`sub-${cat}`} className="bg-[#1B3A2D]/30">
                        <td colSpan={4} className="px-3 py-1.5 text-[#74C69D] text-xs font-bold">{cat} Subtotal</td>
                        <td className="px-3 py-1.5 text-white text-xs font-bold text-right">{fmtINR(cp)}</td>
                        <td className="px-3 py-1.5 text-[#00CC88] text-xs font-bold text-right">{fmtINR(ca)}</td>
                        <td className={`px-3 py-1.5 text-xs font-bold text-right ${(cp-ca) < 0 ? 'text-[#FF3333]' : 'text-[#00A2FF]'}`}>{fmtINR(Math.abs(cp-ca))}</td>
                        <td colSpan={2} />
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tab 4: Financials ───────────────────────────────────────────────────────

function FinancialsTab({ accounts }) {
  if (!accounts.length) return (
    <p className="text-[#8892B0] text-sm text-center py-16">No accounts found. Run the seed endpoint first.</p>
  )

  const totLive   = accounts.reduce((s, a) => s + (a.live_balance ?? a.current_balance ?? 0), 0)
  const totAlloc  = accounts.reduce((s, a) => s + (a.allocated_amount || 0), 0)
  const totPaid   = accounts.reduce((s, a) => s + (a.paid_expenses || 0), 0)

  return (
    <div className="space-y-5">
      <p className="text-xs text-[#8892B0] font-semibold">ACCOUNT SUMMARY — auto-calculated from Budget Tracker actuals</p>

      {accounts.map(a => {
        const live      = a.live_balance ?? a.current_balance ?? 0
        const proposed  = a.allocated_amount || 0
        const spent     = a.paid_expenses || 0
        const remaining = live - spent
        const sufficient = remaining >= 0

        return (
          <div key={a.id} className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl overflow-hidden">
            {/* Account header */}
            <div className="flex items-center justify-between px-5 py-4 bg-[#1B3A2D] border-b border-[#2D2B5A]">
              <div>
                <p className="text-[#74C69D] text-xs font-semibold">ACCOUNT</p>
                <p className="text-white font-fredoka font-bold text-lg">{a.name}</p>
              </div>
              <span className={`px-3 py-1.5 rounded-full text-sm font-bold ${sufficient ? 'bg-[#00CC88]/15 text-[#00CC88]' : 'bg-[#FF3333]/15 text-[#FF3333]'}`}>
                {sufficient ? 'Sufficient ✓' : 'Shortfall ✗'}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[#2D2B5A]">
              {[
                ['Funds Available', fmtINR(live),     'text-white'],
                ['Proposed Expense', fmtINR(proposed), 'text-[#8892B0]'],
                ['Expense Spent', fmtINR(spent),       'text-[#00CC88]'],
                ['Remaining', fmtINR(Math.abs(remaining)), remaining < 0 ? 'text-[#FF3333]' : 'text-[#00A2FF]'],
              ].map(([lbl, val, cls]) => (
                <div key={lbl} className="p-4 text-center">
                  <p className="text-[#8892B0] text-xs font-semibold mb-1">{lbl}</p>
                  <p className={`font-bold text-base ${cls}`}>{val}</p>
                </div>
              ))}
            </div>
            {/* Spend bar */}
            {proposed > 0 && (
              <div className="px-5 pb-4">
                <div className="flex items-center justify-between text-xs text-[#8892B0] mb-1.5">
                  <span>Spent: {proposed > 0 ? ((spent/proposed)*100).toFixed(1) : 0}% of proposed</span>
                  <span>{fmtINR(proposed - spent)} remaining vs proposed</span>
                </div>
                <div className="h-2 bg-[#0F0F23] rounded-full overflow-hidden">
                  <div className="h-full bg-[#00CC88] rounded-full" style={{ width: `${Math.min((spent/proposed)*100, 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* Total row */}
      <div className="bg-[#16213E] border border-[#1B3A2D] rounded-2xl overflow-hidden">
        <div className="px-5 py-3 bg-[#1B3A2D]">
          <p className="text-[#74C69D] text-xs font-bold">TOTAL ACROSS ALL ACCOUNTS</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-[#2D2B5A]">
          {[
            ['Total Available', fmtINR(totLive), 'text-white'],
            ['Total Proposed',  fmtINR(totAlloc),'text-[#8892B0]'],
            ['Total Spent',     fmtINR(totPaid), 'text-[#00CC88]'],
          ].map(([lbl, val, cls]) => (
            <div key={lbl} className="p-4 text-center">
              <p className="text-[#8892B0] text-xs font-semibold mb-1">{lbl}</p>
              <p className={`font-bold text-base ${cls}`}>{val}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function AdminTasks() {
  const [tasks,    setTasks]    = useState([])
  const [summary,  setSummary]  = useState(null)
  const [accounts, setAccounts] = useState([])
  const [budgetItems, setBudgetItems] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [tab,      setTab]      = useState('dashboard')
  const [selectedTask, setSelectedTask] = useState(null)
  const [showNewTask,  setShowNewTask]  = useState(false)

  const load = useCallback(async () => {
    try {
      const [tRes, sRes, aRes, bRes] = await Promise.all([
        getAdminTasks(), getAdminTasksSummary(), getFinanceAccounts(), getBudgetItems(),
      ])
      setTasks(tRes.data)
      setSummary(sRes.data)
      setAccounts(aRes.data)
      setBudgetItems(bRes.data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleUpdate() {
    await load()
    if (selectedTask) {
      const fresh = (await getAdminTasks()).data
      setTasks(fresh)
      setSelectedTask(fresh.find(t => t.id === selectedTask.id) || null)
    }
  }

  async function handleStatusChange(taskId, newStatus) {
    await updateAdminTask(taskId, { status: newStatus })
    setTasks(ts => ts.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
  }

  const overdueCount = summary?.overdue_count || 0

  if (loading) return (
    <div className="p-8 flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const TABS = [
    { id: 'dashboard', label: '📊 Dashboard' },
    { id: 'tasks',     label: '📋 Task Tracker',   badge: overdueCount },
    { id: 'budget',    label: '📒 Budget Tracker' },
    { id: 'finance',   label: '💳 Financials' },
  ]

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-fredoka font-bold text-white">🌿 Polyhouse Project Tracker</h2>
          <p className="text-[#8892B0] text-sm mt-0.5">2.5-Acre NVPH · Kurchapally · Agri Blooms</p>
        </div>
        {tab === 'tasks' && (
          <button onClick={() => setShowNewTask(true)}
            className="px-5 py-2.5 bg-[#00A2FF] hover:bg-[#0088CC] text-white rounded-xl font-nunito font-semibold text-sm">
            + New Task
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-1 w-fit overflow-x-auto">
        {TABS.map(({ id, label, badge }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`relative px-4 py-2 rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === id ? 'bg-[#00A2FF]/15 text-[#00A2FF]' : 'text-[#8892B0] hover:text-white'
            }`}>
            {label}
            {badge > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#FF3333] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && <DashboardTab summary={summary} accounts={accounts} />}
      {tab === 'tasks'     && (
        <TaskTrackerTab
          tasks={tasks}
          onTaskClick={setSelectedTask}
          onStatusChange={handleStatusChange}
          onNewTask={() => setShowNewTask(true)}
        />
      )}
      {tab === 'budget'    && <BudgetTrackerTab items={budgetItems} accounts={accounts} onRefresh={load} />}
      {tab === 'finance'   && <FinancialsTab accounts={accounts} />}

      {/* Modals */}
      {showNewTask && (
        <TaskModal onSave={() => { setShowNewTask(false); load() }} onClose={() => setShowNewTask(false)} />
      )}
      {selectedTask && (
        <TaskDetail task={selectedTask} allTasks={tasks} onUpdate={handleUpdate} onClose={() => setSelectedTask(null)} />
      )}
    </div>
  )
}
