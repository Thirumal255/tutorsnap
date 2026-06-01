import { useState, useEffect, useCallback } from 'react'
import {
  getAdminTasks, getAdminTasksSummary, getAdminTaskCategories,
  createAdminTask, updateAdminTask, deleteAdminTask,
  addTaskExpense, deleteTaskExpense,
} from './api/client'

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtINR(v) {
  if (!v && v !== 0) return '₹0'
  if (v >= 1_00_00_000) return `₹${parseFloat((v/1_00_00_000).toFixed(2))}Cr`
  if (v >= 1_00_000)    return `₹${parseFloat((v/1_00_000).toFixed(2))}L`
  return `₹${v.toLocaleString('en-IN')}`
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
}
function fmtShort(d) {
  if (!d) return null
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short'})
}
function isOverdue(t) {
  if (!t.end_date || t.status==='completed') return false
  return new Date(t.end_date) < new Date(new Date().toDateString())
}
function daysLeft(d) {
  if (!d) return null
  return Math.ceil((new Date(d)-new Date(new Date().toDateString()))/86400000)
}

const S = {
  not_started:{ label:'Not Started', color:'text-[#8892B0]', bg:'bg-[#8892B0]/10', dot:'bg-[#8892B0]' },
  in_progress: { label:'In Progress', color:'text-[#00A2FF]', bg:'bg-[#00A2FF]/10', dot:'bg-[#00A2FF]' },
  completed:   { label:'Completed',   color:'text-[#00CC88]', bg:'bg-[#00CC88]/10', dot:'bg-[#00CC88]' },
  on_hold:     { label:'On Hold',     color:'text-[#FFB347]', bg:'bg-[#FFB347]/10', dot:'bg-[#FFB347]' },
}
const PRI_BORDER = { high:'border-l-[#FF3333]', medium:'border-l-[#FFB347]', low:'border-l-[#00CC88]' }

// ── Small Components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = S[status]||S.not_started
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${m.bg} ${m.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`}/>
      {m.label}
    </span>
  )
}

function BudgetBar({ budget, spent, compact=false }) {
  if (!budget||budget<=0) return null
  const pct = Math.min((spent/budget)*100,100)
  const over = spent>budget
  const barColor = over?'bg-[#FF3333]':pct>80?'bg-[#FFB347]':'bg-[#00CC88]'
  if (compact) return (
    <div className="space-y-0.5">
      <div className="h-1.5 bg-[#0F0F23] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{width:`${pct}%`}}/>
      </div>
      <div className="flex justify-between text-[10px] text-[#8892B0]">
        <span>{fmtINR(spent)} spent</span><span>{fmtINR(budget)} budget</span>
      </div>
    </div>
  )
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-[#8892B0]">Budget: <span className="text-white font-semibold">{fmtINR(budget)}</span></span>
        <span className={over?'text-[#FF3333] font-bold':'text-[#00CC88] font-semibold'}>
          {over?`Over by ${fmtINR(spent-budget)}`:`${fmtINR(budget-spent)} left`}
        </span>
      </div>
      <div className="h-2 bg-[#0F0F23] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{width:`${pct}%`}}/>
      </div>
      <div className="flex justify-between text-xs text-[#8892B0]">
        <span>Spent: {fmtINR(spent)}</span><span>{pct.toFixed(0)}% used</span>
      </div>
    </div>
  )
}

// ── Bottom Sheet ───────────────────────────────────────────────────────────────

function BottomSheet({ show, onClose, title, children }) {
  if (!show) return null
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-[#16213E] border-t border-[#2D2B5A] rounded-t-3xl max-h-[92vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-[#2D2B5A] rounded-full"/>
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-[#2D2B5A] flex-shrink-0">
            <h2 className="text-white font-bold text-base">{title}</h2>
            <button onClick={onClose} className="text-[#8892B0] hover:text-white text-xl w-8 h-8 flex items-center justify-center">✕</button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 pb-8">{children}</div>
      </div>
    </div>
  )
}

// ── Task Card ──────────────────────────────────────────────────────────────────

function TaskCard({ task, onClick }) {
  const overdue = isOverdue(task)
  const days = daysLeft(task.end_date)
  const spent = task.total_expense||0
  return (
    <div onClick={()=>onClick(task)}
      className={`bg-[#16213E] border border-[#2D2B5A] border-l-4 ${PRI_BORDER[task.priority]||'border-l-[#8892B0]'} rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-all hover:border-[#00A2FF]/40 space-y-3`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-white font-semibold text-sm leading-snug">{task.title}</h3>
          <p className="text-[#8892B0] text-xs mt-0.5">{task.category}</p>
        </div>
        <StatusBadge status={task.status}/>
      </div>
      {task.budget>0 && <BudgetBar budget={task.budget} spent={spent} compact/>}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          {task.end_date && (
            <span className={`flex items-center gap-1 ${overdue?'text-[#FF3333] font-semibold':days<=2?'text-[#FFB347]':'text-[#8892B0]'}`}>
              {overdue?'⚠️':'📅'} {fmtShort(task.end_date)}
              {overdue?` (${Math.abs(days)}d late)`:days!=null&&days<=3?` (${days}d)`:''}
            </span>
          )}
          {task.subtasks?.length>0&&(
            <span className="text-[#8892B0]">· {task.subtasks.filter(s=>s.status==='completed').length}/{task.subtasks.length} sub</span>
          )}
        </div>
        <span className={`w-2 h-2 rounded-full ${S[task.status]?.dot||'bg-[#8892B0]'}`}/>
      </div>
    </div>
  )
}

// ── Task Form ──────────────────────────────────────────────────────────────────

function TaskForm({ task, categories, onSave, onClose }) {
  const isEdit = !!task?.id
  const [addingCat, setAddingCat] = useState(categories.length===0)
  const inp = "w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF] placeholder-[#8892B0]"
  const lbl = "block text-xs text-[#8892B0] font-semibold mb-1.5"
  const [form, setForm] = useState({
    title: task?.title||'', notes: task?.notes||'',
    status: task?.status||'not_started', priority: task?.priority||'medium',
    category: task?.category||categories[0]||'',
    start_date: task?.start_date||'', end_date: task?.end_date||'',
    budget: task?.budget??'', newCategory:'',
    expense_amount:'', expense_description:'',
    expense_date: new Date().toISOString().split('T')[0],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  async function handleSave() {
    if (!form.title.trim()) return setError('Title is required')
    const cat = addingCat ? form.newCategory.trim() : form.category
    if (!cat) return setError('Category is required')
    setSaving(true); setError('')
    const expAmount = parseFloat(form.expense_amount)
    const budgetAmount = parseFloat(form.budget)
    const payload = {
      title: form.title.trim(), notes: form.notes.trim()||null,
      status: form.status, priority: form.priority, category: cat,
      start_date: form.start_date||null, end_date: form.end_date||null,
      budget: budgetAmount>0 ? budgetAmount : null,
      expense_amount: !isEdit&&expAmount>0 ? expAmount : null,
      expense_description: !isEdit ? form.expense_description.trim()||null : null,
      expense_date: !isEdit&&expAmount>0 ? form.expense_date : null,
    }
    try {
      if (isEdit) await updateAdminTask(task.id, payload)
      else await createAdminTask(payload)
      await onSave(); onClose()
    } catch(e) { setError(e.response?.data?.detail||'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <label className={lbl}>Title *</label>
        <input value={form.title} onChange={e=>set('title',e.target.value)} className={inp} placeholder="What needs to be done?" autoFocus/>
      </div>
      <div>
        <label className={lbl}>Category *</label>
        {addingCat ? (
          <div className="flex gap-2">
            <input value={form.newCategory} onChange={e=>set('newCategory',e.target.value)} className={`${inp} flex-1`} placeholder="New category name"/>
            {categories.length>0&&<button onClick={()=>setAddingCat(false)} className="text-[#8892B0] text-sm px-3">Cancel</button>}
          </div>
        ) : (
          <div className="flex gap-2">
            <select value={form.category} onChange={e=>set('category',e.target.value)} className={`${inp} flex-1`}>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={()=>setAddingCat(true)} className="text-[#00A2FF] text-sm px-3 border border-[#2D2B5A] rounded-xl">+ New</button>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Status</label>
          <select value={form.status} onChange={e=>set('status',e.target.value)} className={inp}>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <div>
          <label className={lbl}>Priority</label>
          <select value={form.priority} onChange={e=>set('priority',e.target.value)} className={inp}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Start Date</label><input type="date" value={form.start_date} onChange={e=>set('start_date',e.target.value)} className={inp}/></div>
        <div><label className={lbl}>End Date</label><input type="date" value={form.end_date} onChange={e=>set('end_date',e.target.value)} className={inp}/></div>
      </div>
      <div>
        <label className={lbl}>Budget (₹) — optional</label>
        <input type="number" value={form.budget} onChange={e=>set('budget',e.target.value)} className={inp} placeholder="e.g. 50000" min="0"/>
      </div>
      {!isEdit && (
        <div className="bg-[#0F0F23] rounded-2xl p-4 space-y-3 border border-[#2D2B5A]/50">
          <p className="text-xs text-[#8892B0] font-semibold">💰 Add Expense (optional)</p>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Amount (₹)</label><input type="number" value={form.expense_amount} onChange={e=>set('expense_amount',e.target.value)} className={inp} placeholder="0.00" min="0"/></div>
            <div><label className={lbl}>Date</label><input type="date" value={form.expense_date} onChange={e=>set('expense_date',e.target.value)} className={inp}/></div>
          </div>
          <input value={form.expense_description} onChange={e=>set('expense_description',e.target.value)} className={inp} placeholder="Expense description"/>
        </div>
      )}
      <div>
        <label className={lbl}>Notes</label>
        <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} className={`${inp} resize-none`} rows={3} placeholder="Additional notes..."/>
      </div>
      {error&&<p className="text-[#FF3333] text-xs bg-[#FF3333]/10 rounded-xl p-3">{error}</p>}
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-[#00A2FF] text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 active:scale-[0.98] transition-all">
        {saving?'Saving…':isEdit?'Save Changes':'Create Task'}
      </button>
    </div>
  )
}

// ── Add Expense Form ───────────────────────────────────────────────────────────

function AddExpenseForm({ task, onSave, onClose }) {
  const inp = "w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF] placeholder-[#8892B0]"
  const lbl = "block text-xs text-[#8892B0] font-semibold mb-1.5"
  const [form, setForm] = useState({ amount:'', description:'', expense_date: new Date().toISOString().split('T')[0] })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  async function handleSave() {
    const amount = parseFloat(form.amount)
    if (isNaN(amount)||amount<=0) return setError('Enter a valid amount')
    setSaving(true); setError('')
    try {
      await addTaskExpense(task.id,{amount,description:form.description||null,expense_date:form.expense_date})
      await onSave(); onClose()
    } catch(e) { setError(e.response?.data?.detail||'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="bg-[#0F0F23] rounded-2xl p-3">
        <p className="text-[#8892B0] text-xs">Adding expense to</p>
        <p className="text-white font-semibold text-sm mt-0.5">{task.title}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Amount (₹) *</label><input type="number" value={form.amount} onChange={e=>set('amount',e.target.value)} className={inp} placeholder="0.00" min="0" autoFocus/></div>
        <div><label className={lbl}>Date</label><input type="date" value={form.expense_date} onChange={e=>set('expense_date',e.target.value)} className={inp}/></div>
      </div>
      <div><label className={lbl}>Description</label><input value={form.description} onChange={e=>set('description',e.target.value)} className={inp} placeholder="What was this for?"/></div>
      {error&&<p className="text-[#FF3333] text-xs">{error}</p>}
      <button onClick={handleSave} disabled={saving} className="w-full bg-[#00CC88] text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50">
        {saving?'Adding…':'Add Expense'}
      </button>
    </div>
  )
}

// ── Set Budget Form ────────────────────────────────────────────────────────────

function SetBudgetForm({ task, allTasks, onSave, onClose }) {
  const inp = "w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF] placeholder-[#8892B0]"
  const totalExp = (task.expenses||[]).reduce((s,e)=>s+e.amount,0)
  const subTotal = (allTasks||[]).filter(t=>t.parent_id===task.id).reduce((s,t)=>s+(t.total_expense||0),0)
  const minBudget = totalExp+subTotal
  const [val, setVal] = useState(task.budget?String(task.budget):'')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function doSave(override) {
    const v = override!==undefined ? override : val
    const n = parseFloat(v)
    if (v!==''&&v!=='0'&&(isNaN(n)||n<0)) return setError('Enter a valid amount')
    if (v!==''&&n>0&&n<minBudget) return setError(`Budget must be ≥ ${fmtINR(minBudget)}`)
    setSaving(true); setError('')
    try {
      await updateAdminTask(task.id,{budget: v===''||n===0 ? 0 : n})
      await onSave(); onClose()
    } catch(e) { setError(e.response?.data?.detail||'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="bg-[#0F0F23] rounded-2xl p-3">
        <p className="text-[#8892B0] text-xs">Budget for</p>
        <p className="text-white font-semibold text-sm mt-0.5">{task.title}</p>
        {minBudget>0&&<p className="text-[#8892B0] text-xs mt-1">Min: {fmtINR(minBudget)} (total expenses)</p>}
      </div>
      <div>
        <label className="block text-xs text-[#8892B0] font-semibold mb-1.5">Amount (₹)</label>
        <input type="number" value={val} onChange={e=>setVal(e.target.value)} className={inp} placeholder="Leave empty to clear" min="0" autoFocus/>
      </div>
      {error&&<p className="text-[#FF3333] text-xs">{error}</p>}
      <button onClick={()=>doSave()} disabled={saving} className="w-full bg-[#00A2FF] text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50">
        {saving?'Saving…':task.budget?'Update Budget':'Set Budget'}
      </button>
      {task.budget>0&&(
        <button onClick={()=>doSave('0')} className="w-full border border-[#FF3333]/40 text-[#FF3333] py-3 rounded-2xl text-sm">
          Clear Budget
        </button>
      )}
    </div>
  )
}

// ── Task Detail ────────────────────────────────────────────────────────────────

function TaskDetail({ task, allTasks, onEdit, onRefresh, onClose }) {
  const [showExp, setShowExp] = useState(false)
  const [showBudget, setShowBudget] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const overdue = isOverdue(task)
  const spent = task.total_expense||0
  const subtasks = (allTasks||[]).filter(t=>t.parent_id===task.id)

  async function handleDelete() {
    if (!confirm('Delete this task?')) return
    setDeleting(true)
    try { await deleteAdminTask(task.id); await onRefresh(); onClose() }
    finally { setDeleting(false) }
  }

  async function handleDeleteExp(expId) {
    try { await deleteTaskExpense(task.id,expId); await onRefresh() }
    catch(e) { alert(e.response?.data?.detail||'Failed') }
  }

  return (
    <>
      <div className="p-5 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${task.priority==='high'?'bg-[#FF3333]':task.priority==='medium'?'bg-[#FFB347]':'bg-[#00CC88]'}`}/>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-lg leading-snug">{task.title}</h2>
            <p className="text-[#8892B0] text-sm mt-0.5">{task.category}</p>
          </div>
          <StatusBadge status={task.status}/>
        </div>

        {task.budget>0&&<BudgetBar budget={task.budget} spent={spent}/>}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3">
          {task.start_date&&(
            <div className="bg-[#0F0F23] rounded-2xl p-3">
              <p className="text-[#8892B0] text-xs">Start</p>
              <p className="text-white text-sm font-semibold mt-0.5">{fmtDate(task.start_date)}</p>
            </div>
          )}
          {task.end_date&&(
            <div className={`rounded-2xl p-3 ${overdue?'bg-[#FF3333]/10 border border-[#FF3333]/20':'bg-[#0F0F23]'}`}>
              <p className={`text-xs ${overdue?'text-[#FF3333]':'text-[#8892B0]'}`}>{overdue?'⚠️ Overdue':'Due'}</p>
              <p className="text-white text-sm font-semibold mt-0.5">{fmtDate(task.end_date)}</p>
            </div>
          )}
          <div className="bg-[#0F0F23] rounded-2xl p-3">
            <p className="text-[#8892B0] text-xs">Priority</p>
            <p className={`text-sm font-semibold mt-0.5 ${task.priority==='high'?'text-[#FF3333]':task.priority==='medium'?'text-[#FFB347]':'text-[#00CC88]'}`}>
              {task.priority?.charAt(0).toUpperCase()+task.priority?.slice(1)}
            </p>
          </div>
          <div className="bg-[#0F0F23] rounded-2xl p-3">
            <p className="text-[#8892B0] text-xs">Budget</p>
            <p className="text-white text-sm font-semibold mt-0.5">{task.budget?fmtINR(task.budget):'—'}</p>
          </div>
        </div>

        {task.notes&&(
          <div className="bg-[#0F0F23] rounded-2xl p-4">
            <p className="text-[#8892B0] text-xs font-semibold mb-1">Notes</p>
            <p className="text-white text-sm leading-relaxed">{task.notes}</p>
          </div>
        )}

        {subtasks.length>0&&(
          <div>
            <p className="text-[#8892B0] text-xs font-semibold mb-2">
              Sub-tasks ({subtasks.filter(s=>s.status==='completed').length}/{subtasks.length} done)
            </p>
            <div className="space-y-2">
              {subtasks.map(st=>(
                <div key={st.id} className="flex items-center gap-3 bg-[#0F0F23] rounded-xl px-3 py-2.5">
                  <StatusBadge status={st.status}/>
                  <span className="text-white text-xs flex-1">{st.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expenses */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[#8892B0] text-xs font-semibold">
              Expenses{spent>0?` · ${fmtINR(spent)} total`:''}
            </p>
            <button onClick={()=>setShowBudget(true)} className="text-[#00A2FF] text-xs">
              {task.budget?'Edit Budget':'Set Budget'}
            </button>
          </div>
          {task.expenses?.length>0 ? (
            <div className="space-y-2">
              {task.expenses.map(e=>(
                <div key={e.id} className="flex items-center gap-3 bg-[#0F0F23] rounded-xl px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold">{fmtINR(e.amount)}</p>
                    <p className="text-[#8892B0] text-xs truncate">{e.description||'—'} · {fmtShort(e.expense_date)}</p>
                  </div>
                  <button onClick={()=>handleDeleteExp(e.id)} className="text-[#8892B0] hover:text-[#FF3333] text-xl leading-none">×</button>
                </div>
              ))}
            </div>
          ) : <p className="text-[#8892B0] text-xs italic">No expenses yet</p>}
          <button onClick={()=>setShowExp(true)}
            className="mt-3 w-full border border-dashed border-[#2D2B5A] text-[#8892B0] hover:text-white hover:border-[#00A2FF] py-2.5 rounded-xl text-sm transition-all">
            + Add Expense
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={onEdit} className="flex-1 bg-[#00A2FF]/15 text-[#00A2FF] font-semibold py-3 rounded-2xl text-sm">Edit</button>
          <button onClick={handleDelete} disabled={deleting} className="flex-1 bg-[#FF3333]/10 text-[#FF3333] font-semibold py-3 rounded-2xl text-sm disabled:opacity-50">
            {deleting?'Deleting…':'Delete'}
          </button>
        </div>
      </div>

      <BottomSheet show={showExp} onClose={()=>setShowExp(false)} title="Add Expense">
        <AddExpenseForm task={task} onSave={onRefresh} onClose={()=>setShowExp(false)}/>
      </BottomSheet>
      <BottomSheet show={showBudget} onClose={()=>setShowBudget(false)} title="Set Budget">
        <SetBudgetForm task={task} allTasks={allTasks} onSave={onRefresh} onClose={()=>setShowBudget(false)}/>
      </BottomSheet>
    </>
  )
}

// ── Overview Tab ───────────────────────────────────────────────────────────────

// ── Home Tab ───────────────────────────────────────────────────────────────────

function HomeTab({ tasks, onTaskClick }) {
  const today = new Date(new Date().toDateString())
  const in2days = new Date(today); in2days.setDate(today.getDate()+2)
  const root = tasks.filter(t=>!t.parent_id)

  const ongoing = root.filter(t=>t.status==='in_progress')
  const upcoming = root.filter(t=>{
    if (t.status!=='not_started'||!t.start_date) return false
    const sd = new Date(t.start_date+'T00:00:00')
    return sd>=today && sd<=in2days
  })

  // Group ongoing by category
  const byCategory = {}
  ongoing.forEach(t=>{
    if (!byCategory[t.category]) byCategory[t.category]=[]
    byCategory[t.category].push(t)
  })

  const today_str = today.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short'})

  return (
    <div className="p-4 pb-28 space-y-6">
      {/* Date */}
      <p className="text-[#8892B0] text-xs font-semibold">{today_str}</p>

      {/* Ongoing */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">🔄</span>
          <h2 className="text-white font-bold text-base">Ongoing</h2>
          <span className="bg-[#00A2FF]/15 text-[#00A2FF] text-xs font-bold px-2 py-0.5 rounded-full">{ongoing.length}</span>
        </div>

        {ongoing.length===0 ? (
          <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-6 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-[#8892B0] text-sm">No ongoing tasks</p>
          </div>
        ) : (
          <div className="space-y-4">
            {Object.entries(byCategory).sort().map(([cat,catTasks])=>{
              const catOverdue = catTasks.filter(isOverdue)
              return (
                <div key={cat}>
                  {/* Category label */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[#8892B0] text-xs font-semibold uppercase tracking-wider">{cat}</span>
                    {catOverdue.length>0&&(
                      <span className="bg-[#FF3333]/15 text-[#FF3333] text-xs font-bold px-2 py-0.5 rounded-full">
                        ⚠️ {catOverdue.length} overdue
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {catTasks.map(t=>{
                      const overdue = isOverdue(t)
                      const days = daysLeft(t.end_date)
                      const spent = t.total_expense||0
                      return (
                        <div key={t.id} onClick={()=>onTaskClick(t)}
                          className={`border-l-4 rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-all space-y-2 ${
                            overdue
                              ? 'bg-[#FF3333]/8 border-l-[#FF3333] border border-[#FF3333]/20'
                              : `bg-[#16213E] border border-[#2D2B5A] ${PRI_BORDER[t.priority]||'border-l-[#8892B0]'}`
                          }`}>
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-white font-semibold text-sm leading-snug flex-1">{t.title}</p>
                            {overdue&&(
                              <span className="bg-[#FF3333]/15 text-[#FF3333] text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">
                                {Math.abs(days)}d late
                              </span>
                            )}
                          </div>
                          {t.end_date&&!overdue&&(
                            <p className={`text-xs flex items-center gap-1 ${days!=null&&days<=2?'text-[#FFB347]':'text-[#8892B0]'}`}>
                              📅 Due {fmtShort(t.end_date)}{days!=null&&days<=3?` · ${days}d left`:''}
                            </p>
                          )}
                          {overdue&&t.end_date&&(
                            <p className="text-[#FF3333] text-xs">📅 Was due {fmtShort(t.end_date)}</p>
                          )}
                          {t.budget>0&&<BudgetBar budget={t.budget} spent={spent} compact/>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Upcoming */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-base">📅</span>
          <h2 className="text-white font-bold text-base">Coming Up</h2>
          <span className="text-[#8892B0] text-xs">next 2 days</span>
          {upcoming.length>0&&<span className="bg-[#FFB347]/15 text-[#FFB347] text-xs font-bold px-2 py-0.5 rounded-full">{upcoming.length}</span>}
        </div>

        {upcoming.length===0 ? (
          <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-5 text-center">
            <p className="text-[#8892B0] text-sm">Nothing starting in the next 2 days</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.map(t=>{
              const days = daysLeft(t.start_date)
              return (
                <div key={t.id} onClick={()=>onTaskClick(t)}
                  className="bg-[#16213E] border border-[#FFB347]/20 border-l-4 border-l-[#FFB347] rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-all space-y-1">
                  <p className="text-white font-semibold text-sm">{t.title}</p>
                  <div className="flex items-center justify-between">
                    <p className="text-[#8892B0] text-xs">{t.category}</p>
                    <span className="text-[#FFB347] text-xs font-semibold">
                      {days===0?'Starts today':days===1?'Starts tomorrow':`Starts in ${days}d`} · {fmtShort(t.start_date)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Overview Tab ───────────────────────────────────────────────────────────────

function OverviewTab({ tasks, summary, onTaskClick }) {
  const totalBudget = summary.total_budget||0
  const totalSpent  = summary.total_spent||0
  const root = tasks.filter(t=>!t.parent_id)
  const overdueTasks = root.filter(isOverdue)
  const counts = { not_started:0, in_progress:0, completed:0, on_hold:0 }
  root.forEach(t=>{ if(counts[t.status]!==undefined) counts[t.status]++ })
  const byCategory = {}
  root.forEach(t=>{ if(!byCategory[t.category]) byCategory[t.category]=[]; byCategory[t.category].push(t) })

  return (
    <div className="p-4 space-y-5 pb-28">
      {overdueTasks.length>0&&(
        <div className="bg-[#FF3333]/10 border border-[#FF3333]/30 rounded-2xl p-4">
          <p className="text-[#FF3333] font-bold text-sm mb-2">⚠️ {overdueTasks.length} overdue</p>
          {overdueTasks.slice(0,3).map(t=>(
            <p key={t.id} onClick={()=>onTaskClick(t)} className="text-[#FF3333]/80 text-xs cursor-pointer hover:text-[#FF3333] py-0.5">
              · {t.title}
            </p>
          ))}
        </div>
      )}

      {/* Status grid */}
      <div className="grid grid-cols-2 gap-3">
        {[
          {key:'in_progress',label:'In Progress',color:'text-[#00A2FF]',bg:'bg-[#00A2FF]/10'},
          {key:'not_started',label:'Not Started',color:'text-[#8892B0]',bg:'bg-[#8892B0]/10'},
          {key:'completed',  label:'Completed',  color:'text-[#00CC88]',bg:'bg-[#00CC88]/10'},
          {key:'on_hold',    label:'On Hold',    color:'text-[#FFB347]',bg:'bg-[#FFB347]/10'},
        ].map(({key,label,color,bg})=>(
          <div key={key} className={`${bg} rounded-2xl p-4`}>
            <p className={`text-3xl font-fredoka font-bold ${color}`}>{counts[key]}</p>
            <p className="text-[#8892B0] text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Budget overview */}
      {(totalBudget>0||totalSpent>0)&&(
        <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-5 space-y-4">
          <p className="text-white font-bold text-sm">💰 Budget Overview</p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[#8892B0] text-xs">Allocated</p>
              <p className="text-white font-bold mt-0.5">{fmtINR(totalBudget)}</p>
            </div>
            <div>
              <p className="text-[#8892B0] text-xs">Spent</p>
              <p className="text-[#FFB347] font-bold mt-0.5">{fmtINR(totalSpent)}</p>
            </div>
            <div>
              <p className="text-[#8892B0] text-xs">Remaining</p>
              <p className={`font-bold mt-0.5 ${totalBudget-totalSpent<0?'text-[#FF3333]':'text-[#00CC88]'}`}>{fmtINR(totalBudget-totalSpent)}</p>
            </div>
          </div>
          {totalBudget>0&&<BudgetBar budget={totalBudget} spent={totalSpent}/>}
        </div>
      )}

      {/* Categories */}
      <div>
        <p className="text-[#8892B0] text-xs font-semibold mb-3">By Category</p>
        <div className="space-y-3">
          {Object.entries(byCategory).sort().map(([cat,catTasks])=>{
            const catBudget = catTasks.reduce((s,t)=>s+(t.budget||0),0)
            const catSpent  = catTasks.reduce((s,t)=>s+(t.total_expense||0),0)
            const catOverdue = catTasks.filter(isOverdue).length
            const sc = {}
            catTasks.forEach(t=>{ sc[t.status]=(sc[t.status]||0)+1 })
            return (
              <div key={cat} className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-semibold text-sm">{cat}</p>
                    <p className="text-[#8892B0] text-xs mt-0.5">{catTasks.length} tasks{catOverdue>0?` · ⚠️ ${catOverdue} overdue`:''}</p>
                  </div>
                  {catBudget>0&&(
                    <div className="text-right">
                      <p className="text-white text-xs font-semibold">{fmtINR(catSpent)}</p>
                      <p className="text-[#8892B0] text-xs">of {fmtINR(catBudget)}</p>
                    </div>
                  )}
                </div>
                {catBudget>0&&<BudgetBar budget={catBudget} spent={catSpent} compact/>}
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(sc).map(([st,n])=>(
                    <span key={st} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${S[st]?.bg} ${S[st]?.color}`}>
                      {n} {S[st]?.label}
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ── Tasks Tab ──────────────────────────────────────────────────────────────────

function TasksTab({ tasks, categories, onTaskClick, filterStatus, setFilterStatus, filterCat, setFilterCat }) {
  const root = tasks.filter(t=>!t.parent_id)
  const filtered = root
    .filter(t=>filterStatus==='all'||t.status===filterStatus)
    .filter(t=>filterCat==='all'||t.category===filterCat)

  return (
    <div className="pb-28">
      {/* Status chips */}
      <div className="px-4 pt-4 pb-2 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
        {[{key:'all',label:'All'},{key:'in_progress',label:'In Progress'},{key:'not_started',label:'Not Started'},
          {key:'on_hold',label:'On Hold'},{key:'completed',label:'Completed'}].map(f=>(
          <button key={f.key} onClick={()=>setFilterStatus(f.key)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              filterStatus===f.key?'bg-[#00A2FF] text-white':'bg-[#16213E] text-[#8892B0] border border-[#2D2B5A]'
            }`}>{f.label}</button>
        ))}
      </div>
      {/* Category filter */}
      <div className="px-4 pb-3">
        <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
          className="w-full bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#00A2FF]">
          <option value="all">All Categories</option>
          {categories.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="px-4 pb-2"><p className="text-[#8892B0] text-xs">{filtered.length} task{filtered.length!==1?'s':''}</p></div>
      <div className="px-4 space-y-3">
        {filtered.length===0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-[#8892B0] text-sm">No tasks match this filter</p>
          </div>
        ) : filtered.map(t=><TaskCard key={t.id} task={t} onClick={onTaskClick}/>)}
      </div>
    </div>
  )
}

// ── Expenses Tab ───────────────────────────────────────────────────────────────

function ExpensesTab({ tasks, summary }) {
  const [expanded, setExpanded] = useState({})
  const root = tasks.filter(t=>!t.parent_id)
  const totalBudget = summary.total_budget||0
  const totalSpent  = summary.total_spent||0
  const byCategory = {}
  root.forEach(t=>{ if(!byCategory[t.category]) byCategory[t.category]=[]; byCategory[t.category].push(t) })

  return (
    <div className="p-4 pb-28 space-y-5">
      {/* Summary card */}
      <div className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[#8892B0] text-xs">Spent</p>
            <p className="text-[#FFB347] font-fredoka font-bold text-xl mt-0.5">{fmtINR(totalSpent)}</p>
          </div>
          <div>
            <p className="text-[#8892B0] text-xs">Budget</p>
            <p className="text-white font-fredoka font-bold text-xl mt-0.5">{totalBudget>0?fmtINR(totalBudget):'—'}</p>
          </div>
          <div>
            <p className="text-[#8892B0] text-xs">Left</p>
            <p className={`font-fredoka font-bold text-xl mt-0.5 ${totalBudget>0?(totalBudget-totalSpent<0?'text-[#FF3333]':'text-[#00CC88]'):'text-[#8892B0]'}`}>
              {totalBudget>0?fmtINR(totalBudget-totalSpent):'—'}
            </p>
          </div>
        </div>
        {totalBudget>0&&<BudgetBar budget={totalBudget} spent={totalSpent}/>}
      </div>

      {/* Category sections */}
      {Object.entries(byCategory).sort().map(([cat,catTasks])=>{
        const catBudget = catTasks.reduce((s,t)=>s+(t.budget||0),0)
        const catSpent  = catTasks.reduce((s,t)=>s+(t.total_expense||0),0)
        if (catSpent===0&&catBudget===0) return null
        const pct = catBudget>0?Math.min(catSpent/catBudget*100,100):100
        const isOpen = expanded[cat]
        const barColor = pct>=100?'bg-[#FF3333]':pct>80?'bg-[#FFB347]':'bg-[#00CC88]'

        return (
          <div key={cat} className="bg-[#16213E] border border-[#2D2B5A] rounded-2xl overflow-hidden">
            <button className="w-full p-4 text-left space-y-3" onClick={()=>setExpanded(e=>({...e,[cat]:!e[cat]}))}>
              <div className="flex items-center justify-between">
                <p className="text-white font-semibold text-sm">{cat}</p>
                <span className="text-[#8892B0] text-xs">{isOpen?'▲':'▼'}</span>
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-white font-bold text-base">{fmtINR(catSpent)}</p>
                  {catBudget>0&&<p className="text-[#8892B0] text-xs">of {fmtINR(catBudget)}</p>}
                </div>
                {catBudget>0&&(
                  <p className={`text-sm font-semibold ${pct>=100?'text-[#FF3333]':pct>80?'text-[#FFB347]':'text-[#00CC88]'}`}>
                    {pct.toFixed(0)}% used
                  </p>
                )}
              </div>
              {catBudget>0&&(
                <div className="h-2 bg-[#0F0F23] rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${barColor}`} style={{width:`${pct}%`}}/>
                </div>
              )}
            </button>
            {isOpen&&(
              <div className="border-t border-[#2D2B5A]">
                {catTasks.filter(t=>(t.total_expense||0)>0||t.budget>0).map(t=>{
                  const ts = t.total_expense||0
                  const tp = t.budget>0?Math.min(ts/t.budget*100,100):0
                  return (
                    <div key={t.id} className="px-4 py-3 border-b border-[#2D2B5A]/50 last:border-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-white text-xs font-semibold flex-1 mr-2 truncate">{t.title}</p>
                        <p className="text-[#FFB347] text-xs font-semibold">{fmtINR(ts)}</p>
                      </div>
                      {t.budget>0&&(
                        <div className="space-y-1">
                          <div className="h-1.5 bg-[#0F0F23] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${tp>=100?'bg-[#FF3333]':tp>80?'bg-[#FFB347]':'bg-[#00CC88]'}`} style={{width:`${tp}%`}}/>
                          </div>
                          <p className="text-[#8892B0] text-xs">{fmtINR(t.budget)} budget · {fmtINR(t.budget-ts)} left</p>
                        </div>
                      )}
                    </div>
                  )
                })}
                {catTasks.filter(t=>(t.total_expense||0)>0||t.budget>0).length===0&&(
                  <p className="px-4 py-3 text-[#8892B0] text-xs italic">No expenses</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function TasksPage({ onLogout }) {
  const [tasks, setTasks] = useState([])
  const [summary, setSummary] = useState({})
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('home')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterCat, setFilterCat] = useState('all')
  const [selectedTask, setSelectedTask] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editTask, setEditTask] = useState(null)

  const load = useCallback(async () => {
    try {
      const [t,s,c] = await Promise.all([getAdminTasks(),getAdminTasksSummary(),getAdminTaskCategories()])
      setTasks(t.data); setSummary(s.data); setCategories(c.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(()=>{ load() },[load])

  async function refresh() {
    const [t,s,c] = await Promise.all([getAdminTasks(),getAdminTasksSummary(),getAdminTaskCategories()])
    setTasks(t.data); setSummary(s.data); setCategories(c.data)
    if (selectedTask) {
      const updated = t.data.find(x=>x.id===selectedTask.id)
      if (updated) setSelectedTask(updated)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const NAV = [
    {key:'home',    icon:'🏠',label:'Home'},
    {key:'overview',icon:'📊',label:'Overview'},
    {key:'tasks',   icon:'📋',label:'Tasks'},
    {key:'expenses',icon:'💰',label:'Expenses'},
  ]

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col max-w-2xl mx-auto relative">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0F0F23]/95 backdrop-blur-md border-b border-[#2D2B5A] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-white font-fredoka font-bold text-xl leading-none">My Tasks</h1>
          <p className="text-[#8892B0] text-xs mt-0.5">Personal task tracker</p>
        </div>
        <div className="flex items-center gap-2">
          {(tab==='tasks'||tab==='home')&&(
            <button onClick={()=>setShowCreate(true)} className="bg-[#00A2FF] text-white text-xs font-bold px-4 py-2 rounded-xl">
              + New
            </button>
          )}
          <button onClick={onLogout} className="text-[#8892B0] text-xs px-3 py-2 rounded-xl border border-[#2D2B5A]">
            Sign out
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab==='home'&&<HomeTab tasks={tasks} onTaskClick={setSelectedTask}/>}
        {tab==='overview'&&<OverviewTab tasks={tasks} summary={summary} onTaskClick={setSelectedTask}/>}
        {tab==='tasks'&&<TasksTab tasks={tasks} categories={categories} onTaskClick={setSelectedTask}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterCat={filterCat} setFilterCat={setFilterCat}/>}
        {tab==='expenses'&&<ExpensesTab tasks={tasks} summary={summary}/>}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 max-w-2xl mx-auto z-30 bg-[#16213E]/95 backdrop-blur-md border-t border-[#2D2B5A]">
        <div className="flex">
          {NAV.map(n=>(
            <button key={n.key} onClick={()=>setTab(n.key)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all relative ${tab===n.key?'text-[#00A2FF]':'text-[#8892B0]'}`}>
              {tab===n.key&&<div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-[#00A2FF] rounded-full"/>}
              <span className="text-xl leading-none">{n.icon}</span>
              <span className="text-[10px] font-semibold">{n.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Task Detail */}
      <BottomSheet show={!!selectedTask} onClose={()=>setSelectedTask(null)}>
        {selectedTask&&<TaskDetail task={selectedTask} allTasks={tasks}
          onEdit={()=>{setEditTask(selectedTask);setSelectedTask(null)}}
          onRefresh={refresh} onClose={()=>setSelectedTask(null)}/>}
      </BottomSheet>

      {/* Create */}
      <BottomSheet show={showCreate} onClose={()=>setShowCreate(false)} title="New Task">
        <TaskForm task={null} categories={categories} onSave={refresh} onClose={()=>setShowCreate(false)}/>
      </BottomSheet>

      {/* Edit */}
      <BottomSheet show={!!editTask} onClose={()=>setEditTask(null)} title="Edit Task">
        {editTask&&<TaskForm task={editTask} categories={categories} onSave={refresh} onClose={()=>setEditTask(null)}/>}
      </BottomSheet>
    </div>
  )
}
