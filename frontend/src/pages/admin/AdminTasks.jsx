import { useState, useEffect, useCallback } from 'react'
import {
  getAdminTasks, getAdminTasksSummary, getAdminTaskCategories,
  createAdminTask, updateAdminTask, deleteAdminTask,
  addTaskExpense, deleteTaskExpense,
} from '../../api/client'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  not_started: { label: 'Not Started', color: 'bg-[#2D2B5A] text-[#8892B0]',      dot: 'bg-[#8892B0]' },
  in_progress:  { label: 'In Progress', color: 'bg-[#00A2FF]/15 text-[#00A2FF]',   dot: 'bg-[#00A2FF]' },
  completed:    { label: 'Completed',   color: 'bg-[#00CC88]/15 text-[#00CC88]',   dot: 'bg-[#00CC88]' },
  on_hold:      { label: 'On Hold',     color: 'bg-[#FFB347]/15 text-[#FFB347]',   dot: 'bg-[#FFB347]' },
}

const PRIORITY_META = {
  low:    { label: 'Low',    color: 'text-[#8892B0]' },
  medium: { label: 'Medium', color: 'text-[#FFB347]' },
  high:   { label: 'High',   color: 'text-[#FF3333]' },
}

const STATUSES = Object.keys(STATUS_META)
const PRIORITIES = Object.keys(PRIORITY_META)

function fmt(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function isOverdue(task) {
  if (!task.end_date || task.status === 'completed') return false
  return new Date(task.end_date) < new Date(new Date().toDateString())
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.not_started
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const m = PRIORITY_META[priority] || PRIORITY_META.medium
  return <span className={`text-xs font-bold ${m.color}`}>{m.label}</span>
}

function SummaryCard({ icon, label, value, sub, accent }) {
  return (
    <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-5 flex flex-col gap-1">
      <span className="text-2xl">{icon}</span>
      <p className="text-[#8892B0] text-xs font-semibold mt-1">{label}</p>
      <p className={`text-2xl font-fredoka font-bold ${accent || 'text-white'}`}>{value}</p>
      {sub && <p className="text-[#8892B0] text-xs">{sub}</p>}
    </div>
  )
}

// ── Task Form Modal ────────────────────────────────────────────────────────────

function TaskModal({ task, categories, allTasks, onSave, onClose }) {
  const isEdit = !!task?.id
  const [form, setForm] = useState({
    title: task?.title || '',
    notes: task?.notes || '',
    status: task?.status || 'not_started',
    priority: task?.priority || 'medium',
    category: task?.category || (categories[0] || ''),
    start_date: task?.start_date || '',
    end_date: task?.end_date || '',
    parent_id: task?.parent_id || '',
    dependency_ids: task?.dependency_ids || [],
    newCategory: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const categoryOptions = form.newCategory
    ? [...categories, form.newCategory]
    : categories

  const eligibleDeps = allTasks.filter(t => t.id !== task?.id)

  async function handleSave() {
    if (!form.title.trim()) return setError('Title is required')
    const cat = form.newCategory.trim() || form.category
    if (!cat) return setError('Category is required')
    setSaving(true)
    setError('')
    const payload = {
      title: form.title.trim(),
      notes: form.notes.trim() || null,
      status: form.status,
      priority: form.priority,
      category: cat,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      parent_id: form.parent_id ? parseInt(form.parent_id) : null,
      dependency_ids: form.dependency_ids,
    }
    try {
      if (isEdit) {
        await updateAdminTask(task.id, payload)
      } else {
        await createAdminTask(payload)
      }
      onSave()
    } catch (e) {
      setError(e.response?.data?.detail || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function toggleDep(id) {
    set('dependency_ids', form.dependency_ids.includes(id)
      ? form.dependency_ids.filter(d => d !== id)
      : [...form.dependency_ids, id])
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[#2D2B5A] flex items-center justify-between">
          <h3 className="text-lg font-fredoka font-bold text-white">{isEdit ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl leading-none">×</button>
        </div>

        <div className="p-6 space-y-4">
          {error && <p className="text-[#FF3333] text-sm bg-[#FF3333]/10 border border-[#FF3333]/20 rounded-xl px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Title *</label>
            <input value={form.title} onChange={e => set('title', e.target.value)}
              className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]"
              placeholder="Task title" />
          </div>

          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3}
              className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF] resize-none"
              placeholder="Details, notes..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Status</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]">
                {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Priority</label>
              <select value={form.priority} onChange={e => set('priority', e.target.value)}
                className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]">
                {PRIORITIES.map(p => <option key={p} value={p}>{PRIORITY_META[p].label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Category *</label>
            {categories.length > 0 && !form.newCategory && (
              <select value={form.category} onChange={e => set('category', e.target.value)}
                className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF] mb-2">
                {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            )}
            <input value={form.newCategory} onChange={e => set('newCategory', e.target.value)}
              className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]"
              placeholder={categories.length > 0 ? 'Or type a new category...' : 'Category name (e.g. Flat Purchase)'} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Start Date</label>
              <input type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)}
                className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]" />
            </div>
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">End Date</label>
              <input type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)}
                className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]" />
            </div>
          </div>

          {allTasks.length > 0 && (
            <div>
              <label className="block text-xs text-[#8892B0] font-semibold mb-1">Depends On</label>
              <div className="max-h-36 overflow-y-auto space-y-1 bg-[#0F0F23] border border-[#2D2B5A] rounded-xl p-2">
                {eligibleDeps.filter(t => !form.category || t.category === (form.newCategory || form.category)).map(t => (
                  <label key={t.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#16213E] cursor-pointer">
                    <input type="checkbox" checked={form.dependency_ids.includes(t.id)}
                      onChange={() => toggleDep(t.id)}
                      className="accent-[#00A2FF]" />
                    <span className="text-white text-xs">{t.title}</span>
                    <StatusBadge status={t.status} />
                  </label>
                ))}
                {eligibleDeps.filter(t => !form.category || t.category === (form.newCategory || form.category)).length === 0 && (
                  <p className="text-[#8892B0] text-xs px-2 py-1">No other tasks in this category yet</p>
                )}
              </div>
              <p className="text-[#8892B0] text-xs mt-1">Only tasks in the same category shown</p>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-[#2D2B5A] flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[#8892B0] hover:text-white border border-[#2D2B5A] rounded-xl text-sm font-semibold transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-[#00A2FF] hover:bg-[#0088CC] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Expense Modal ──────────────────────────────────────────────────────────────

function ExpenseModal({ task, onSave, onClose }) {
  const [form, setForm] = useState({ amount: '', description: '', expense_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    const amount = parseFloat(form.amount)
    if (!amount || amount <= 0) return setError('Enter a valid amount')
    if (!form.expense_date) return setError('Date is required')
    setSaving(true)
    setError('')
    try {
      await addTaskExpense(task.id, { amount, description: form.description || null, expense_date: form.expense_date })
      onSave()
    } catch (e) {
      setError(e.response?.data?.detail || 'Failed to add expense')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl w-full max-w-sm">
        <div className="p-5 border-b border-[#2D2B5A] flex items-center justify-between">
          <h3 className="text-base font-fredoka font-bold text-white">Add Expense — {task.title}</h3>
          <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-3">
          {error && <p className="text-[#FF3333] text-sm">{error}</p>}
          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Amount (₹) *</label>
            <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)}
              className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]"
              placeholder="0.00" min="0" step="0.01" />
          </div>
          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)}
              className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]"
              placeholder="What was this for?" />
          </div>
          <div>
            <label className="block text-xs text-[#8892B0] font-semibold mb-1">Date *</label>
            <input type="date" value={form.expense_date} onChange={e => set('expense_date', e.target.value)}
              className="w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]" />
          </div>
        </div>
        <div className="p-5 border-t border-[#2D2B5A] flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-[#8892B0] hover:text-white border border-[#2D2B5A] rounded-xl text-sm font-semibold transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-[#00CC88] hover:bg-[#00AA77] disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
            {saving ? 'Adding...' : 'Add Expense'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Task Detail Panel ──────────────────────────────────────────────────────────

function TaskDetail({ task, allTasks, categories, onUpdate, onClose }) {
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [showSubtaskModal, setShowSubtaskModal] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const depTasks = allTasks.filter(t => task.dependency_ids?.includes(t.id))
  const blockedTasks = allTasks.filter(t => t.dependency_ids?.includes(task.id))

  async function handleDelete() {
    if (!confirm(`Delete "${task.title}"? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await deleteAdminTask(task.id)
      onUpdate()
      onClose()
    } catch {
      setDeleting(false)
    }
  }

  async function handleDeleteExpense(expId) {
    if (!confirm('Remove this expense?')) return
    await deleteTaskExpense(task.id, expId)
    onUpdate()
  }

  async function quickStatus(status) {
    await updateAdminTask(task.id, { status })
    onUpdate()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 flex items-start justify-end p-4" onClick={e => e.target === e.currentTarget && onClose()}>
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl w-full max-w-md h-full max-h-[calc(100vh-2rem)] overflow-y-auto flex flex-col">

          {/* Header */}
          <div className="p-5 border-b border-[#2D2B5A] flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-[#8892B0] font-semibold mb-1">{task.category}</p>
                <h3 className="text-base font-fredoka font-bold text-white leading-tight">{task.title}</h3>
              </div>
              <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl leading-none flex-shrink-0">×</button>
            </div>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <StatusBadge status={task.status} />
              <PriorityBadge priority={task.priority} />
              {isOverdue(task) && (
                <span className="text-xs font-bold text-[#FF3333] bg-[#FF3333]/10 px-2 py-0.5 rounded-full">OVERDUE</span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#0F0F23] rounded-xl p-3">
                <p className="text-[#8892B0] text-xs mb-1">Start</p>
                <p className="text-white text-sm font-semibold">{fmt(task.start_date)}</p>
              </div>
              <div className={`bg-[#0F0F23] rounded-xl p-3 ${isOverdue(task) ? 'border border-[#FF3333]/40' : ''}`}>
                <p className="text-[#8892B0] text-xs mb-1">Due</p>
                <p className={`text-sm font-semibold ${isOverdue(task) ? 'text-[#FF3333]' : 'text-white'}`}>{fmt(task.end_date)}</p>
              </div>
            </div>

            {/* Notes */}
            {task.notes && (
              <div>
                <p className="text-xs text-[#8892B0] font-semibold mb-1">Notes</p>
                <p className="text-white text-sm whitespace-pre-wrap">{task.notes}</p>
              </div>
            )}

            {/* Quick status change */}
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

            {/* Dependencies */}
            {depTasks.length > 0 && (
              <div>
                <p className="text-xs text-[#8892B0] font-semibold mb-2">Depends On</p>
                <div className="space-y-1">
                  {depTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-2 bg-[#0F0F23] rounded-xl px-3 py-2">
                      <StatusBadge status={t.status} />
                      <span className="text-white text-xs">{t.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {blockedTasks.length > 0 && (
              <div>
                <p className="text-xs text-[#8892B0] font-semibold mb-2">Blocks</p>
                <div className="space-y-1">
                  {blockedTasks.map(t => (
                    <div key={t.id} className="flex items-center gap-2 bg-[#0F0F23] rounded-xl px-3 py-2">
                      <StatusBadge status={t.status} />
                      <span className="text-white text-xs">{t.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Sub-tasks */}
            {task.subtasks && task.subtasks.length > 0 && (
              <div>
                <p className="text-xs text-[#8892B0] font-semibold mb-2">Sub-tasks ({task.subtasks.length})</p>
                <div className="space-y-1">
                  {task.subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 bg-[#0F0F23] rounded-xl px-3 py-2">
                      <StatusBadge status={st.status} />
                      <span className="text-white text-xs flex-1">{st.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expenses */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-[#8892B0] font-semibold">Expenses</p>
                <p className="text-sm font-bold text-[#00CC88]">₹{task.total_expense?.toLocaleString('en-IN') || 0}</p>
              </div>
              {task.expenses?.length > 0 ? (
                <div className="space-y-1">
                  {task.expenses.map(e => (
                    <div key={e.id} className="flex items-center gap-2 bg-[#0F0F23] rounded-xl px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-xs font-semibold">₹{e.amount?.toLocaleString('en-IN')}</p>
                        {e.description && <p className="text-[#8892B0] text-xs truncate">{e.description}</p>}
                      </div>
                      <p className="text-[#8892B0] text-xs flex-shrink-0">{fmt(e.expense_date)}</p>
                      <button onClick={() => handleDeleteExpense(e.id)}
                        className="text-[#FF3333]/50 hover:text-[#FF3333] text-xs transition-colors">✕</button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#8892B0] text-xs">No expenses recorded</p>
              )}
              <button onClick={() => setShowExpenseModal(true)}
                className="mt-2 w-full text-xs text-[#00A2FF] hover:text-white border border-[#00A2FF]/30 hover:border-[#00A2FF] rounded-xl py-2 transition-colors">
                + Add Expense
              </button>
            </div>
          </div>

          {/* Footer actions */}
          <div className="p-5 border-t border-[#2D2B5A] flex gap-2 flex-shrink-0">
            <button onClick={() => setShowSubtaskModal(true)}
              className="flex-1 text-xs text-[#8892B0] hover:text-white border border-[#2D2B5A] hover:border-[#8892B0] rounded-xl py-2 transition-colors">
              + Sub-task
            </button>
            <button onClick={() => setShowEditModal(true)}
              className="flex-1 text-xs bg-[#00A2FF]/15 text-[#00A2FF] hover:bg-[#00A2FF]/25 rounded-xl py-2 font-semibold transition-colors">
              Edit
            </button>
            <button onClick={handleDelete} disabled={deleting}
              className="flex-1 text-xs bg-[#FF3333]/10 text-[#FF3333] hover:bg-[#FF3333]/20 rounded-xl py-2 font-semibold transition-colors disabled:opacity-50">
              {deleting ? '...' : 'Delete'}
            </button>
          </div>
        </div>
      </div>

      {showExpenseModal && (
        <ExpenseModal task={task} onSave={() => { setShowExpenseModal(false); onUpdate() }} onClose={() => setShowExpenseModal(false)} />
      )}
      {showEditModal && (
        <TaskModal task={task} categories={categories} allTasks={allTasks}
          onSave={() => { setShowEditModal(false); onUpdate() }} onClose={() => setShowEditModal(false)} />
      )}
      {showSubtaskModal && (
        <TaskModal
          task={{ category: task.category, parent_id: task.id, dependency_ids: [] }}
          categories={categories} allTasks={allTasks}
          onSave={() => { setShowSubtaskModal(false); onUpdate() }}
          onClose={() => setShowSubtaskModal(false)} />
      )}
    </>
  )
}

// ── Task Row ───────────────────────────────────────────────────────────────────

function TaskRow({ task, onClick }) {
  const overdue = isOverdue(task)
  return (
    <div
      onClick={() => onClick(task)}
      className={`bg-[#16213E] border rounded-2xl p-4 cursor-pointer hover:border-[#00A2FF]/50 transition-all group ${
        overdue ? 'border-[#FF3333]/40' : 'border-[#2D2B5A]'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-xs text-[#8892B0] font-semibold">{task.category}</span>
            {overdue && <span className="text-xs font-bold text-[#FF3333] bg-[#FF3333]/10 px-1.5 py-0.5 rounded-full">OVERDUE</span>}
          </div>
          <p className="text-white font-semibold text-sm group-hover:text-[#00A2FF] transition-colors">{task.title}</p>
          {task.notes && <p className="text-[#8892B0] text-xs mt-1 line-clamp-1">{task.notes}</p>}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
            {task.end_date && <span className="text-xs text-[#8892B0]">Due {fmt(task.end_date)}</span>}
            {task.subtasks?.length > 0 && (
              <span className="text-xs text-[#8892B0]">📋 {task.subtasks.length} sub-tasks</span>
            )}
            {task.dependency_ids?.length > 0 && (
              <span className="text-xs text-[#8892B0]">🔗 {task.dependency_ids.length} deps</span>
            )}
          </div>
        </div>
        {task.total_expense > 0 && (
          <div className="text-right flex-shrink-0">
            <p className="text-xs text-[#8892B0]">Spent</p>
            <p className="text-sm font-bold text-[#00CC88]">₹{task.total_expense?.toLocaleString('en-IN')}</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Expense Report Tab ─────────────────────────────────────────────────────────

function ExpenseReport({ summary }) {
  if (!summary) return null
  const cats = Object.entries(summary.expense_by_category || {}).sort((a, b) => b[1] - a[1])

  function exportCSV() {
    const rows = [['Category', 'Amount (Rs)'], ...cats.map(([k, v]) => [k, v])]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'expense_report.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[#8892B0] text-sm">Total across all tasks</p>
          <p className="text-3xl font-fredoka font-bold text-[#00CC88]">₹{summary.total_expense?.toLocaleString('en-IN')}</p>
        </div>
        <button onClick={exportCSV}
          className="px-4 py-2 bg-[#00A2FF]/15 text-[#00A2FF] hover:bg-[#00A2FF]/25 rounded-xl text-sm font-semibold transition-colors">
          Export CSV
        </button>
      </div>

      <div>
        <p className="text-xs text-[#8892B0] font-semibold mb-3">By Category</p>
        <div className="space-y-2">
          {cats.map(([cat, amt]) => {
            const pct = summary.total_expense > 0 ? (amt / summary.total_expense) * 100 : 0
            return (
              <div key={cat} className="bg-[#16213E] border border-[#2D2B5A] rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white text-sm font-semibold">{cat}</span>
                  <span className="text-[#00CC88] font-bold text-sm">₹{amt?.toLocaleString('en-IN')}</span>
                </div>
                <div className="h-1.5 bg-[#0F0F23] rounded-full overflow-hidden">
                  <div className="h-full bg-[#00CC88] rounded-full transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[#8892B0] text-xs mt-1">{pct.toFixed(1)}% of total</p>
              </div>
            )
          })}
          {cats.length === 0 && <p className="text-[#8892B0] text-sm">No expenses recorded yet</p>}
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function AdminTasks() {
  const [tasks, setTasks]         = useState([])
  const [summary, setSummary]     = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading]     = useState(true)
  const [tab, setTab]             = useState('tasks')   // tasks | overview | expenses
  const [filterCat, setFilterCat] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [selectedTask, setSelectedTask] = useState(null)
  const [showNewTask, setShowNewTask]   = useState(false)

  const load = useCallback(async () => {
    try {
      const [tRes, sRes, cRes] = await Promise.all([
        getAdminTasks(),
        getAdminTasksSummary(),
        getAdminTaskCategories(),
      ])
      setTasks(tRes.data)
      setSummary(sRes.data)
      setCategories(cRes.data)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Refresh selected task data after updates
  async function handleUpdate() {
    await load()
    if (selectedTask) {
      const fresh = (await getAdminTasks()).data
      setTasks(fresh)
      const updated = fresh.find(t => t.id === selectedTask.id)
      setSelectedTask(updated || null)
    }
  }

  const allFlat = tasks.flatMap(t => [t, ...(t.subtasks || [])])

  const visible = tasks.filter(t => {
    if (filterCat !== 'all' && t.category !== filterCat) return false
    if (filterStatus !== 'all' && t.status !== filterStatus) return false
    return true
  })

  const overdueCount = summary?.overdue_count || 0

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-fredoka font-bold text-white">✅ My Tasks</h2>
          <p className="text-[#8892B0] text-sm mt-0.5">Personal task &amp; expense tracker</p>
        </div>
        <button onClick={() => setShowNewTask(true)}
          className="px-5 py-2.5 bg-[#00A2FF] hover:bg-[#0088CC] text-white rounded-xl font-nunito font-semibold text-sm transition-colors">
          + New Task
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-1 w-fit">
        {[['overview', '📊 Overview'], ['tasks', '📋 Tasks'], ['expenses', '💰 Expenses']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors relative ${
              tab === id ? 'bg-[#00A2FF]/15 text-[#00A2FF]' : 'text-[#8892B0] hover:text-white'
            }`}>
            {label}
            {id === 'tasks' && overdueCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#FF3333] text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                {overdueCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {tab === 'overview' && summary && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <SummaryCard icon="📋" label="Total Tasks" value={summary.total} />
            <SummaryCard icon="🔄" label="In Progress" value={summary.by_status?.in_progress || 0} accent="text-[#00A2FF]" />
            <SummaryCard icon="✅" label="Completed" value={summary.by_status?.completed || 0} accent="text-[#00CC88]" />
            <SummaryCard icon="⚠️" label="Overdue" value={overdueCount} accent={overdueCount > 0 ? 'text-[#FF3333]' : 'text-white'} />
          </div>

          {summary.overdue?.length > 0 && (
            <div>
              <p className="text-xs text-[#FF3333] font-semibold mb-3">OVERDUE TASKS</p>
              <div className="space-y-2">
                {summary.overdue.map(t => (
                  <div key={t.id} onClick={() => { setTab('tasks'); setSelectedTask(t) }}
                    className="bg-[#16213E] border border-[#FF3333]/30 rounded-xl px-4 py-3 cursor-pointer hover:border-[#FF3333]/60 transition-colors flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{t.title}</p>
                      <p className="text-[#8892B0] text-xs">{t.category} · Due {fmt(t.end_date)}</p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Status breakdown */}
          <div>
            <p className="text-xs text-[#8892B0] font-semibold mb-3">STATUS BREAKDOWN</p>
            <div className="grid grid-cols-2 gap-3">
              {STATUSES.map(s => (
                <div key={s} className="bg-[#16213E] border border-[#2D2B5A] rounded-xl px-4 py-3 flex items-center gap-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${STATUS_META[s].dot}`} />
                  <span className="text-[#8892B0] text-sm">{STATUS_META[s].label}</span>
                  <span className="ml-auto text-white font-bold">{summary.by_status?.[s] || 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {tab === 'tasks' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex gap-2 flex-wrap">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
              className="bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]">
              <option value="all">All Categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              className="bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-[#00A2FF]">
              <option value="all">All Statuses</option>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            <span className="ml-auto text-xs text-[#8892B0] self-center">{visible.length} tasks</span>
          </div>

          {visible.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">📋</p>
              <p className="text-white font-semibold">No tasks found</p>
              <p className="text-[#8892B0] text-sm mt-1">Create your first task to get started</p>
              <button onClick={() => setShowNewTask(true)}
                className="mt-4 px-5 py-2 bg-[#00A2FF] hover:bg-[#0088CC] text-white rounded-xl text-sm font-semibold">
                + New Task
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map(task => (
                <TaskRow key={task.id} task={task} onClick={setSelectedTask} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expenses Tab */}
      {tab === 'expenses' && <ExpenseReport summary={summary} />}

      {/* Modals */}
      {showNewTask && (
        <TaskModal task={null} categories={categories} allTasks={allFlat}
          onSave={() => { setShowNewTask(false); load() }}
          onClose={() => setShowNewTask(false)} />
      )}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          allTasks={allFlat}
          categories={categories}
          onUpdate={handleUpdate}
          onClose={() => setSelectedTask(null)} />
      )}
    </div>
  )
}
