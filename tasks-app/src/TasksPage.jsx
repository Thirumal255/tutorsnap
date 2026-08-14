import { useState, useEffect, useCallback, useRef } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  getAdminTasks, getAdminTasksSummary, getAdminTaskCategories,
  createAdminTask, updateAdminTask, deleteAdminTask,
  addTaskExpense, updateTaskExpense, deleteTaskExpense,
  getFinanceSummary, getFinanceAccounts, createFinanceAccount, updateFinanceAccount, deleteFinanceAccount,
  getFinanceSources, createFinanceSource, updateFinanceSource, deleteFinanceSource,
  getFinanceReceipts, createFinanceReceipt, deleteFinanceReceipt,
  getFinanceAllocations, upsertFinanceAllocation, deleteFinanceAllocation, unlinkFinanceAllocation,
  getFinanceTransfers, createFinanceTransfer, deleteFinanceTransfer,
  getCategoryAccounts, getAccountBreakdown,
  getBudgetItems, createBudgetItem, updateBudgetItem, deleteBudgetItem,
} from './api/client'


// ── Notifications ──────────────────────────────────────────────────────────────

async function setupNotifications(tasks) {
  if (!('Notification' in window)) return
  if (Notification.permission==='default') await Notification.requestPermission()
  if (Notification.permission!=='granted') return

  const today = new Date(new Date().toDateString())
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1)
  const notifiedKey = 'notified_' + today.toISOString().split('T')[0]
  if (sessionStorage.getItem(notifiedKey)) return // only once per session/day

  const dueSoon = tasks.filter(t=>{
    if (!t.end_date || t.status==='completed' || t.parent_id) return false
    const due = new Date(t.end_date+'T00:00:00')
    return due>=today && due<=tomorrow
  })

  if (dueSoon.length===0) return
  sessionStorage.setItem(notifiedKey, '1')

  const todayDue  = dueSoon.filter(t=>new Date(t.end_date+'T00:00:00').getTime()===today.getTime())
  const tmrwDue   = dueSoon.filter(t=>new Date(t.end_date+'T00:00:00').getTime()===tomorrow.getTime())

  if (todayDue.length>0) {
    new Notification(`⚠️ ${todayDue.length} task${todayDue.length>1?'s':''} due TODAY`, {
      body: todayDue.map(t=>t.title).join(', '),
      icon: '/icon-192.png',
    })
  }
  if (tmrwDue.length>0) {
    new Notification(`📅 ${tmrwDue.length} task${tmrwDue.length>1?'s':''} due TOMORROW`, {
      body: tmrwDue.map(t=>t.title).join(', '),
      icon: '/icon-192.png',
    })
  }
}

// ── Long Press Hook ────────────────────────────────────────────────────────────

function useLongPress(onLongPress, ms=600) {
  const timer = useRef(null)
  const fired = useRef(false)
  const start = useCallback(() => {
    fired.current = false
    timer.current = setTimeout(()=>{ fired.current=true; onLongPress() }, ms)
  }, [onLongPress, ms])
  const cancel = useCallback(() => { if(timer.current) clearTimeout(timer.current) }, [])
  const handleClick = useCallback((e) => { if(fired.current) e.stopPropagation() }, [])
  return { onTouchStart:start, onTouchEnd:cancel, onTouchMove:cancel,
           onMouseDown:start, onMouseUp:cancel, onMouseLeave:cancel, onClick:handleClick }
}

// ── Confetti ───────────────────────────────────────────────────────────────────

function Confetti({ onDone }) {
  useEffect(()=>{ const t=setTimeout(onDone,2200); return()=>clearTimeout(t) },[onDone])
  const colors=['#00CC88','#00A2FF','#FFB347','#FF6B9D','#FFD700','#FF3333','#A78BFA']
  const pieces = useRef(Array(50).fill(0).map((_,i)=>({
    id:i, color:colors[i%colors.length],
    left:5+Math.random()*90,
    size:5+Math.random()*7,
    dur:`${0.9+Math.random()*1.2}s`,
    delay:`${Math.random()*0.6}s`,
    round:Math.random()>0.4,
  }))).current
  return (
    <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:9999,overflow:'hidden'}}>
      {pieces.map(p=>(
        <div key={p.id} className="confetti-piece" style={{
          position:'absolute', left:`${p.left}%`, top:-20,
          width:p.size, height:p.size,
          background:p.color,
          borderRadius:p.round?'50%':'2px',
          '--fall-dur':p.dur, '--fall-delay':p.delay,
        }}/>
      ))}
    </div>
  )
}

// ── Status Picker ──────────────────────────────────────────────────────────────

function StatusPicker({ task, onSelect, onClose }) {
  return (
    <div style={{position:'fixed',inset:0,zIndex:60,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{position:'absolute',inset:0,background:'rgba(0,0,0,0.5)',backdropFilter:'blur(4px)'}} onClick={onClose}/>
      <div style={{position:'relative',background:'#16213E',border:'1px solid #2D2B5A',borderRadius:20,padding:20,width:260,zIndex:1}}>
        <p className="text-gray-800 font-bold text-sm mb-3">Change Status</p>
        <p className="text-gray-400 text-xs mb-4 truncate">{task.title}</p>
        <div className="space-y-2">
          {Object.entries(S).map(([key,meta])=>(
            <button key={key} onClick={()=>onSelect(key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                task.status===key?`${meta.bg} border-2 border-current`:`hover:${meta.bg} border border-transparent`
              }`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dot}`}/>
              <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
              {task.status===key&&<span className="ml-auto text-xs text-gray-400">current</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtINR(v) {
  if (!v && v !== 0) return '₹0'
  if (v >= 1_00_00_000) return `₹${parseFloat((v/1_00_00_000).toFixed(3))}Cr`
  if (v >= 1_00_000)    return `₹${parseFloat((v/1_00_000).toFixed(3))}L`
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}`
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
}
function fmtShort(d) {
  if (!d) return null
  return new Date(d+'T00:00:00').toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})
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
  not_started:{ label:'Not Started', color:'text-gray-400', bg:'bg-gray-100', dot:'bg-[#8892B0]' },
  in_progress: { label:'In Progress', color:'text-blue-600', bg:'bg-blue-50', dot:'bg-blue-600' },
  completed:   { label:'Completed',   color:'text-green-600', bg:'bg-green-50', dot:'bg-green-500' },
  on_hold:     { label:'On Hold',     color:'text-amber-500', bg:'bg-amber-50', dot:'bg-amber-400' },
}
const PRI_BORDER = { high:'border-l-red-500', medium:'border-l-amber-400', low:'border-l-green-500' }

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
  const barColor = over?'bg-red-500':pct>80?'bg-amber-400':'bg-green-500'
  if (compact) return (
    <div className="space-y-0.5">
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{width:`${pct}%`}}/>
      </div>
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{fmtINR(spent)} spent</span><span>{fmtINR(budget)} budget</span>
      </div>
    </div>
  )
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Budget: <span className="text-gray-800 font-semibold">{fmtINR(budget)}</span></span>
        <span className={over?'text-red-600 font-bold':'text-green-600 font-semibold'}>
          {over?`Over by ${fmtINR(spent-budget)}`:`${fmtINR(budget-spent)} left`}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{width:`${pct}%`}}/>
      </div>
      <div className="flex justify-between text-xs text-gray-400">
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
      <div className="relative bg-white border-t border-gray-200 rounded-t-3xl max-h-[92vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
          <div className="w-10 h-1 bg-gray-200 rounded-full"/>
        </div>
        {title && (
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
            <h2 className="text-gray-800 font-bold text-base">{title}</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-800 text-xl w-8 h-8 flex items-center justify-center">✕</button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 pb-8">{children}</div>
      </div>
    </div>
  )
}

// ── Task Card ──────────────────────────────────────────────────────────────────

function SubtaskPill({ subtasks }) {
  if (!subtasks?.length) return null
  const done = subtasks.filter(s=>s.status==='completed').length
  const total = subtasks.length
  const pct = Math.round((done/total)*100)
  const all_done = done===total
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${all_done?'bg-green-100 text-green-600':'bg-gray-200/50 text-gray-400'}`}>
      <span>{all_done?'✓':done+'/'+total}</span>
      <span>{total===1?'subtask':'subtasks'}</span>
      {!all_done&&(
        <div className="w-10 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-600 rounded-full" style={{width:`${pct}%`}}/>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, onClick, onStatusChange }) {
  const overdue = isOverdue(task)
  const days = daysLeft(task.end_date)
  const spent = task.total_expense||0
  const [isOpen, setIsOpen] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [completing, setCompleting] = useState(false)
  const longPress = useLongPress(()=>setShowPicker(true))
  const isDone = task.status==='completed'

  async function handleStatusSelect(newStatus) {
    setShowPicker(false)
    if (newStatus===task.status) return
    await updateAdminTask(task.id, {status:newStatus})
    onStatusChange && onStatusChange(task, newStatus)
  }

  async function handleComplete(e) {
    e.stopPropagation()
    setCompleting(true)
    const newStatus = isDone ? 'in_progress' : 'completed'
    await updateAdminTask(task.id, {status: newStatus})
    onStatusChange && onStatusChange(task, newStatus)
    setCompleting(false)
  }

  return (
    <>
      <div {...longPress}
        className={`border border-l-4 ${PRI_BORDER[task.priority]||'border-l-gray-300'} rounded-2xl overflow-hidden select-none ${
          isDone ? 'bg-green-50 border-green-200' : overdue ? 'bg-white border-red-200' : 'bg-white border-gray-200'
        }`}>

        {/* ── Collapsed header (always visible) ── */}
        <div className="flex items-center gap-2.5 p-3 cursor-pointer active:scale-[0.99] transition-all"
          onClick={()=>setIsOpen(o=>!o)}>
          {/* Complete button */}
          <button onClick={handleComplete} disabled={completing}
            className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all ${
              isDone ? 'bg-green-500 border-green-500 text-gray-800'
                     : 'border-gray-200 text-transparent hover:border-green-500 hover:text-green-600'
            }`}>
            <span className="text-xs font-bold leading-none">✓</span>
          </button>

          {/* Title */}
          <h3 className={`flex-1 min-w-0 font-semibold text-sm leading-snug truncate ${isDone?'line-through text-gray-400':'text-gray-800'}`}>
            {task.title}
          </h3>

          {/* Right: urgent hint + chevron */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {overdue&&<span className="text-red-600 text-xs font-bold">{Math.abs(days)}d late</span>}
            {!overdue&&days!=null&&days<=3&&<span className="text-amber-500 text-xs font-semibold">{days}d left</span>}
            <span className="text-gray-500 text-[10px]">{isOpen?'▲':'▼'}</span>
          </div>
        </div>

        {/* ── Expanded detail ── */}
        {isOpen&&(
          <div className="px-3 pb-3 space-y-2 border-t border-gray-200/60">
            {/* Notes */}
            {task.notes&&!isDone&&(
              <p className="text-gray-400 text-xs pt-2">{task.notes}</p>
            )}

            {/* Category + status */}
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <span className="text-gray-500 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full border border-gray-200">{task.category}</span>
              <StatusBadge status={task.status}/>
            </div>

            {/* Date */}
            {(task.start_date||task.end_date)&&(
              <div className="flex items-center gap-1 text-xs">
                <span className={overdue?'text-red-600':days!=null&&days<=2?'text-amber-500':'text-gray-400'}>{overdue?'⚠️':'📅'}</span>
                <span className={overdue?'text-red-600 font-semibold':days!=null&&days<=2?'text-amber-500':'text-gray-400'}>
                  {task.start_date&&fmtShort(task.start_date)}
                  {task.start_date&&task.end_date&&<span className="text-[#2D2B5A]"> → </span>}
                  {task.end_date&&fmtShort(task.end_date)}
                  {overdue?` · ${Math.abs(days)}d late`:days!=null&&days<=3?` · ${days}d left`:''}
                </span>
              </div>
            )}

            {/* Budget + subtasks */}
            {task.budget>0&&<BudgetBar budget={task.budget} spent={spent} compact/>}
            <SubtaskPill subtasks={task.subtasks}/>

            {/* Open full detail */}
            <button onClick={e=>{e.stopPropagation();onClick(task)}}
              className="w-full py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold mt-1">
              Open Task →
            </button>
          </div>
        )}
      </div>
      {showPicker&&<StatusPicker task={task} onSelect={handleStatusSelect} onClose={()=>setShowPicker(false)}/>}
    </>
  )
}

// ── Task Form ──────────────────────────────────────────────────────────────────

function TaskForm({ task, categories, allTasks=[], onSave, onClose }) {
  const isEdit = !!task?.id
  const [addingCat, setAddingCat] = useState(categories.length===0)
  const inp = "w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-400"
  const lbl = "block text-xs text-gray-400 font-semibold mb-1.5"
  const [form, setForm] = useState({
    title: task?.title||'', notes: task?.notes||'',
    status: task?.status||'not_started', priority: task?.priority||'medium',
    category: task?.category||categories[0]||'',
    start_date: task?.start_date||'', end_date: task?.end_date||'',
    budget: task?.budget??'', newCategory:'',
    expense_amount:'', expense_description:'',
    expense_date: new Date().toISOString().split('T')[0],
    dependency_ids: task?.dependency_ids||[],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  // Tasks in the active category (excluding self) for dependency picker
  const activeCat = addingCat ? form.newCategory.trim() : form.category
  const eligibleDeps = allTasks.filter(t=>
    t.category===activeCat && t.id!==task?.id && !t.parent_id
  )
  function toggleDep(id) {
    setForm(f=>({...f, dependency_ids:
      f.dependency_ids.includes(id)
        ? f.dependency_ids.filter(x=>x!==id)
        : [...f.dependency_ids, id]
    }))
  }

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
      dependency_ids: form.dependency_ids,
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
            {categories.length>0&&<button onClick={()=>setAddingCat(false)} className="text-gray-400 text-sm px-3">Cancel</button>}
          </div>
        ) : (
          <div className="flex gap-2">
            <select value={form.category} onChange={e=>set('category',e.target.value)} className={`${inp} flex-1`}>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={()=>setAddingCat(true)} className="text-blue-600 text-sm px-3 border border-gray-200 rounded-xl">+ New</button>
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
        <div className="bg-gray-100 rounded-2xl p-4 space-y-3 border border-gray-200/50">
          <p className="text-xs text-gray-400 font-semibold">💰 Add Expense (optional)</p>
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

      {/* Dependencies */}
      {eligibleDeps.length>0&&(
        <div>
          <label className={lbl}>🔗 Depends On <span className="font-normal">(same category)</span></label>
          <div className="space-y-2 max-h-48 overflow-y-auto bg-gray-100 rounded-xl p-3 border border-gray-200">
            {eligibleDeps.map(t=>{
              const checked = form.dependency_ids.includes(t.id)
              return (
                <div key={t.id} onClick={()=>toggleDep(t.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                    checked?'bg-blue-100 border border-blue-300':'hover:bg-white border border-transparent'
                  }`}>
                  <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                    checked?'bg-blue-600 border-blue-500':'border-gray-200'
                  }`}>
                    {checked&&<span className="text-gray-800 text-xs leading-none">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-xs font-semibold truncate">{t.title}</p>
                    <p className={`text-xs ${S[t.status]?.color||'text-gray-400'}`}>{S[t.status]?.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
          {form.dependency_ids.length>0&&(
            <p className="text-blue-600 text-xs mt-1">{form.dependency_ids.length} dependenc{form.dependency_ids.length>1?'ies':'y'} selected</p>
          )}
        </div>
      )}

      {error&&<p className="text-red-600 text-xs bg-red-50 rounded-xl p-3">{error}</p>}
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-blue-600 text-gray-800 font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 active:scale-[0.98] transition-all">
        {saving?'Saving…':isEdit?'Save Changes':'Create Task'}
      </button>
    </div>
  )
}

// ── Add Expense Form ───────────────────────────────────────────────────────────

function AddExpenseForm({ task, onSave, onClose }) {
  const inp = "w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-400"
  const lbl = "block text-xs text-gray-400 font-semibold mb-1.5"
  const [form, setForm] = useState({ amount:'', description:'', expense_date: new Date().toISOString().split('T')[0], status:'planned', account_id:'' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [catAccounts, setCatAccounts] = useState([])
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  useEffect(()=>{
    if (task.category) {
      getCategoryAccounts(task.category).then(r=>setCatAccounts(r.data||[])).catch(()=>{})
    }
  }, [task.category])

  async function handleSave() {
    const amount = parseFloat(form.amount)
    if (isNaN(amount)||amount<=0) return setError('Enter a valid amount')
    if (form.status==='paid' && !form.account_id) return setError('Select the account this was paid from')
    setSaving(true); setError('')
    try {
      await addTaskExpense(task.id,{
        amount, description:form.description||null,
        expense_date:form.expense_date, status:form.status,
        account_id: form.account_id ? parseInt(form.account_id) : null,
      })
      await onSave(); onClose()
    } catch(e) { setError(e.response?.data?.detail||'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-4">
      <div className="bg-gray-100 rounded-2xl p-3">
        <p className="text-gray-400 text-xs">Adding expense to</p>
        <p className="text-gray-800 font-semibold text-sm mt-0.5">{task.title}</p>
        {task.category&&<p className="text-blue-600 text-xs mt-0.5">Category: {task.category}</p>}
      </div>
      {/* Status toggle */}
      <div className="flex gap-2">
        {[{key:'planned',label:'🕐 Planned',color:'border-amber-400 bg-amber-50 text-amber-500'},
          {key:'paid',   label:'✅ Paid',   color:'border-green-500 bg-green-50 text-green-600'}].map(s=>(
          <button key={s.key} onClick={()=>set('status',s.key)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-all ${form.status===s.key?s.color:'border-gray-200 text-gray-400'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Amount (₹) *</label><input type="number" value={form.amount} onChange={e=>set('amount',e.target.value)} className={inp} placeholder="0.00" min="0" autoFocus/></div>
        <div><label className={lbl}>Date *</label><input type="date" value={form.expense_date} onChange={e=>set('expense_date',e.target.value)} className={inp}/></div>
      </div>
      <div><label className={lbl}>Description</label><input value={form.description} onChange={e=>set('description',e.target.value)} className={inp} placeholder="What was this for?"/></div>
      {/* Account selector — shown always, required when paid */}
      <div>
        <label className={lbl}>
          Paid from account {form.status==='paid'&&<span className="text-red-600">*</span>}
          {catAccounts.length===0&&task.category&&<span className="text-gray-400 font-normal"> (link accounts to "{task.category}" in Finance → Accounts)</span>}
        </label>
        <select className={inp} value={form.account_id} onChange={e=>set('account_id',e.target.value)}>
          <option value="">{form.status==='planned'?'— Not paid yet —':'Select account'}</option>
          {catAccounts.map(a=>(
            <option key={a.id} value={a.id}>
              {a.name} — {fmtINR(a.live_balance||a.current_balance)} available
            </option>
          ))}
        </select>
      </div>
      {error&&<p className="text-red-600 text-xs">{error}</p>}
      <button onClick={handleSave} disabled={saving}
        className={`w-full text-gray-800 font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 ${form.status==='paid'?'bg-green-500':'bg-amber-400'}`}>
        {saving?'Adding…':`Add as ${form.status==='paid'?'Paid':'Planned'}`}
      </button>
    </div>
  )
}

// ── Set Budget Form ────────────────────────────────────────────────────────────

function SetBudgetForm({ task, allTasks, onSave, onClose }) {
  const inp = "w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-400"
  const totalExp = (task.expenses||[]).reduce((s,e)=>s+e.amount,0)
  const subTotal = (task.subtasks||[]).reduce((s,t)=>s+(t.total_expense||0),0)
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
      <div className="bg-gray-100 rounded-2xl p-3">
        <p className="text-gray-400 text-xs">Budget for</p>
        <p className="text-gray-800 font-semibold text-sm mt-0.5">{task.title}</p>
        {minBudget>0&&<p className="text-gray-400 text-xs mt-1">Min: {fmtINR(minBudget)} (total expenses)</p>}
      </div>
      <div>
        <label className="block text-xs text-gray-400 font-semibold mb-1.5">Amount (₹)</label>
        <input type="number" value={val} onChange={e=>setVal(e.target.value)} className={inp} placeholder="Leave empty to clear" min="0" autoFocus/>
      </div>
      {error&&<p className="text-red-600 text-xs">{error}</p>}
      <button onClick={()=>doSave()} disabled={saving} className="w-full bg-blue-600 text-gray-800 font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50">
        {saving?'Saving…':task.budget?'Update Budget':'Set Budget'}
      </button>
      {task.budget>0&&(
        <button onClick={()=>doSave('0')} className="w-full border border-red-200 text-red-600 py-3 rounded-2xl text-sm">
          Clear Budget
        </button>
      )}
    </div>
  )
}

// ── Quick Action Sheet ─────────────────────────────────────────────────────────

function QuickActionSheet({ task, allTasks, onClose, onRefresh, onFullDetail, onEdit }) {
  const [action, setAction] = useState(null) // 'status'|'expense'|'deps'|'subtasks'
  const [selDeps, setSelDeps] = useState(task.dependency_ids||[])
  const overdue = isOverdue(task)
  const spent = task.total_expense || 0
  const subtasks = task.subtasks || []
  const eligible = allTasks.filter(t=>t.category===task.category && t.id!==task.id && !t.parent_id)
  const toggleDep = (id) => setSelDeps(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])

  async function handleStatusSelect(newStatus) {
    setAction(null)
    if (newStatus === task.status) return
    await updateAdminTask(task.id, { status: newStatus })
    await onRefresh()
  }

  async function saveDeps(ids) {
    await updateAdminTask(task.id, { dependency_ids: ids })
    await onRefresh()
    setAction(null)
  }

  if (action === 'status') return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-gray-800 font-bold text-sm">Change Status</p>
        <button onClick={()=>setAction(null)} className="text-gray-400 text-xl">×</button>
      </div>
      <p className="text-gray-400 text-xs truncate mb-3">{task.title}</p>
      {Object.entries(S).map(([key,meta])=>(
        <button key={key} onClick={()=>handleStatusSelect(key)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all border ${
            task.status===key?`${meta.bg} border-current`:`hover:${meta.bg} border-gray-200`
          }`}>
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${meta.dot}`}/>
          <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
          {task.status===key&&<span className="ml-auto text-xs text-gray-400">current</span>}
        </button>
      ))}
    </div>
  )

  if (action === 'expense') return (
    <AddExpenseForm task={task} onSave={async()=>{await onRefresh();setAction(null)}} onClose={()=>setAction(null)}/>
  )

  if (action === 'deps') return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-gray-800 font-bold text-sm">🔗 Dependencies</p>
        <button onClick={()=>setAction(null)} className="text-gray-400 text-xl">×</button>
      </div>
      <p className="text-gray-400 text-xs mb-2">{task.category} tasks</p>
      {eligible.length===0
        ? <p className="text-gray-400 text-xs italic py-4 text-center">No other tasks in this category</p>
        : <div className="space-y-2 max-h-56 overflow-y-auto">
            {eligible.map(t=>{
              const checked = selDeps.includes(t.id)
              return (
                <div key={t.id} onClick={()=>toggleDep(t.id)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
                    checked?'bg-blue-100 border-blue-300':'bg-gray-100 border-transparent hover:border-gray-200'
                  }`}>
                  <div className={`w-4 h-4 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${checked?'bg-blue-600 border-blue-500':'border-gray-200'}`}>
                    {checked&&<span className="text-gray-800 text-xs">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-800 text-xs font-semibold truncate">{t.title}</p>
                    <p className={`text-xs ${S[t.status]?.color}`}>{S[t.status]?.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
      }
      <button onClick={()=>saveDeps(selDeps)}
        className="w-full bg-blue-600 text-gray-800 font-bold py-3 rounded-2xl text-sm">
        Save
      </button>
    </div>
  )

  if (action === 'subtasks') return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-gray-800 font-bold text-sm">📋 Sub-tasks</p>
        <button onClick={()=>setAction(null)} className="text-gray-400 text-xl">×</button>
      </div>
      <p className="text-gray-400 text-xs truncate mb-2">{task.title}</p>
      <SubtasksSection task={task} subtasks={subtasks} onRefresh={async()=>{ await onRefresh() }}/>
    </div>
  )

  // Default: quick actions menu
  return (
    <div className="p-5 space-y-4">
      {/* Task header */}
      <div className={`border-l-4 ${PRI_BORDER[task.priority]||'border-l-gray-300'} pl-3 space-y-1`}>
        <p className="text-gray-800 font-bold text-sm leading-snug">{task.title}</p>
        <div className="flex items-center gap-2">
          <p className="text-gray-400 text-xs">{task.category}</p>
          <StatusBadge status={task.status}/>
          {overdue&&<span className="text-red-600 text-xs font-bold">⚠️ Overdue</span>}
        </div>
        {task.budget>0&&<BudgetBar budget={task.budget} spent={spent} compact/>}
      </div>

      {/* Quick action buttons — 2×2 */}
      <div className="grid grid-cols-2 gap-3">
        {[
          {key:'status',   icon:'⚡', label:'Change Status', color:'text-blue-600', bg:'bg-blue-50 border-blue-200'},
          {key:'expense',  icon:'💸', label:'Add Expense',   color:'text-green-600', bg:'bg-green-50 border-green-200'},
          {key:'subtasks', icon:'📋', label:`Sub-tasks${subtasks.length>0?` (${subtasks.length})`:''}`, color:'text-blue-600', bg:'bg-blue-50 border-blue-200'},
          {key:'deps',     icon:'🔗', label:'Dependencies',  color:'text-violet-500', bg:'bg-violet-50 border-violet-200'},
        ].map(btn=>(
          <button key={btn.key} onClick={()=>setAction(btn.key)}
            className={`flex flex-col items-center gap-2 border rounded-2xl p-4 active:scale-95 transition-all ${btn.bg}`}>
            <span className="text-2xl">{btn.icon}</span>
            <p className={`text-xs font-bold text-center leading-tight ${btn.color}`}>{btn.label}</p>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button onClick={onEdit}
          className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-2xl py-3 text-gray-800 font-semibold text-sm bg-gray-50 active:scale-95 transition-all">
          ✏️ Edit Task
        </button>
        <button onClick={onFullDetail}
          className="flex-1 flex items-center justify-center gap-2 border border-gray-200 rounded-2xl py-3 text-gray-400 font-semibold text-sm bg-white active:scale-95 transition-all">
          Details →
        </button>
      </div>
    </div>
  )
}

// ── Task Detail ────────────────────────────────────────────────────────────────

function SubtasksSection({ task, subtasks, onRefresh }) {
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const inp = "flex-1 bg-white border border-gray-300 rounded-xl px-3 py-2 text-gray-800 text-xs focus:outline-none focus:border-blue-500 placeholder-gray-400"

  async function addSubtask() {
    const title = input.trim()
    if (!title) return
    setSaving(true)
    try {
      await createAdminTask({ title, category: task.category, status:'not_started', priority:'medium', parent_id: task.id })
      setInput(''); setAdding(false); await onRefresh()
    } catch(e) { alert(e.response?.data?.detail||'Failed') }
    finally { setSaving(false) }
  }

  async function saveEdit(st) {
    const title = editTitle.trim()
    if (!title) return
    try { await updateAdminTask(st.id, {title}); setEditingId(null); await onRefresh() }
    catch(e) { alert(e.response?.data?.detail||'Failed') }
  }

  async function cycleStatus(st) {
    const order = ['not_started','in_progress','completed','on_hold']
    const next = order[(order.indexOf(st.status)+1) % order.length]
    try { await updateAdminTask(st.id, {status:next}); await onRefresh() }
    catch(e) { alert(e.response?.data?.detail||'Failed') }
  }

  async function deleteSubtask(st) {
    if (!confirm(`Delete "${st.title}"?`)) return
    try { await deleteAdminTask(st.id); await onRefresh() }
    catch(e) { alert(e.response?.data?.detail||'Failed') }
  }

  const done = subtasks.filter(s=>s.status==='completed').length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-500 text-xs font-semibold">
          Sub-tasks {subtasks.length>0&&`(${done}/${subtasks.length} done)`}
        </p>
        <button onClick={()=>{setAdding(a=>!a);setEditingId(null)}}
          className="text-blue-600 text-xs font-semibold">
          {adding?'Cancel':'+ Add'}
        </button>
      </div>

      {subtasks.length>0&&(
        <div className="space-y-1.5 mb-2">
          {subtasks.map(st=>(
            <div key={st.id} className="bg-gray-100 rounded-xl px-3 py-2 space-y-1.5">
              {editingId===st.id ? (
                <div className="flex gap-2">
                  <input value={editTitle} onChange={e=>setEditTitle(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Enter') saveEdit(st); if(e.key==='Escape') setEditingId(null) }}
                    className={inp} autoFocus/>
                  <button onClick={()=>saveEdit(st)} className="text-blue-600 text-xs font-bold px-2">Save</button>
                  <button onClick={()=>setEditingId(null)} className="text-gray-400 text-xs px-1">✕</button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {/* Status cycle button */}
                  <button onClick={()=>cycleStatus(st)}
                    className={`flex-shrink-0 px-1.5 py-0.5 rounded-md text-xs font-semibold ${S[st.status]?.bg} ${S[st.status]?.color}`}>
                    {S[st.status]?.label}
                  </button>
                  <span className={`text-xs flex-1 truncate ${st.status==='completed'?'text-gray-400 line-through':'text-gray-800'}`}>
                    {st.title}
                  </span>
                  {/* Edit */}
                  <button onClick={()=>{setEditingId(st.id);setEditTitle(st.title);setAdding(false)}}
                    className="text-gray-400 hover:text-blue-600 text-xs px-1">✏️</button>
                  {/* Delete */}
                  <button onClick={()=>deleteSubtask(st)} className="text-gray-400 hover:text-red-600 text-base leading-none">×</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {adding&&(
        <div className="flex gap-2 mt-2">
          <input value={input} onChange={e=>setInput(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') addSubtask() }}
            className={inp} placeholder="Sub-task title…" autoFocus/>
          <button onClick={addSubtask} disabled={saving||!input.trim()}
            className="bg-blue-600 text-gray-800 text-xs font-bold px-3 py-2 rounded-xl disabled:opacity-40">
            {saving?'…':'Add'}
          </button>
        </div>
      )}

      {subtasks.length===0&&!adding&&(
        <p className="text-gray-400 text-xs italic">No sub-tasks yet</p>
      )}
    </div>
  )
}

function TaskDetail({ task, allTasks, onEdit, onRefresh, onClose }) {
  const [showExp, setShowExp] = useState(false)
  const [showBudget, setShowBudget] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingExpId, setEditingExpId] = useState(null)
  const [editingExp, setEditingExp] = useState({})
  const [catAccounts, setCatAccounts] = useState([])

  useEffect(()=>{
    if (task.category) {
      getCategoryAccounts(task.category).then(r=>setCatAccounts(r.data||[])).catch(()=>{})
    }
  }, [task.category])

  function startEditExp(e) {
    setEditingExpId(e.id)
    setEditingExp({
      amount: String(e.amount),
      description: e.description||'',
      expense_date: e.expense_date,
      status: e.status,
      account_id: e.account_id||'',
    })
  }

  async function saveEditExp(expId) {
    const amount = parseFloat(editingExp.amount)
    if (isNaN(amount)||amount<=0) return
    if (editingExp.status==='paid' && !editingExp.account_id && catAccounts.length>0) {
      alert('Please select the account this was paid from'); return
    }
    try {
      await updateTaskExpense(task.id, expId, {
        amount,
        description: editingExp.description||null,
        expense_date: editingExp.expense_date,
        status: editingExp.status,
        account_id: editingExp.account_id ? parseInt(editingExp.account_id) : null,
      })
      setEditingExpId(null); await onRefresh()
    } catch(e) { alert(e.response?.data?.detail||'Failed') }
  }

  // When toggling planned→paid via quick tap, open edit form instead
  // so user can select account. paid→planned is fine to toggle directly.
  function handleQuickToggle(e) {
    if (e.status === 'planned') {
      startEditExp({...e, status: 'paid'})   // open edit pre-set to paid
    } else {
      updateTaskExpense(task.id, e.id, { status: 'planned', account_id: null })
        .then(()=>onRefresh())
        .catch(err=>alert(err.response?.data?.detail||'Failed'))
    }
  }
  const overdue = isOverdue(task)
  const spent = task.total_expense||0
  const subtasks = task.subtasks || []

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
          <div className={`w-1 self-stretch rounded-full flex-shrink-0 ${task.priority==='high'?'bg-red-500':task.priority==='medium'?'bg-amber-400':'bg-green-500'}`}/>
          <div className="flex-1 min-w-0">
            <h2 className="text-gray-800 font-bold text-lg leading-snug">{task.title}</h2>
            <p className="text-gray-400 text-sm mt-0.5">{task.category}</p>
          </div>
          <StatusBadge status={task.status}/>
        </div>

        {task.budget>0&&<BudgetBar budget={task.budget} spent={spent}/>}

        {/* Meta */}
        <div className="grid grid-cols-2 gap-3">
          {task.start_date&&(
            <div className="bg-gray-100 rounded-2xl p-3">
              <p className="text-gray-400 text-xs">Start</p>
              <p className="text-gray-800 text-sm font-semibold mt-0.5">{fmtDate(task.start_date)}</p>
            </div>
          )}
          {task.end_date&&(
            <div className={`rounded-2xl p-3 ${overdue?'bg-red-50 border border-red-200':'bg-gray-100'}`}>
              <p className={`text-xs ${overdue?'text-red-600':'text-gray-400'}`}>{overdue?'⚠️ Overdue':'Due'}</p>
              <p className="text-gray-800 text-sm font-semibold mt-0.5">{fmtDate(task.end_date)}</p>
            </div>
          )}
          <div className="bg-gray-100 rounded-2xl p-3">
            <p className="text-gray-400 text-xs">Priority</p>
            <p className={`text-sm font-semibold mt-0.5 ${task.priority==='high'?'text-red-600':task.priority==='medium'?'text-amber-500':'text-green-600'}`}>
              {task.priority?.charAt(0).toUpperCase()+task.priority?.slice(1)}
            </p>
          </div>
          <div className="bg-gray-100 rounded-2xl p-3">
            <p className="text-gray-400 text-xs">Budget</p>
            <p className="text-gray-800 text-sm font-semibold mt-0.5">{task.budget?fmtINR(task.budget):'—'}</p>
          </div>
        </div>

        {task.notes&&(
          <div className="bg-gray-100 rounded-2xl p-4">
            <p className="text-gray-500 text-xs font-semibold mb-1">Notes</p>
            <p className="text-gray-800 text-sm leading-relaxed">{task.notes}</p>
          </div>
        )}

        {/* Sub-tasks */}
        <SubtasksSection task={task} subtasks={subtasks} onRefresh={onRefresh}/>

        {/* Dependencies */}
        {task.dependency_ids?.length>0&&(()=>{
          const deps = task.dependency_ids.map(id=>allTasks.find(t=>t.id===id)).filter(Boolean)
          return deps.length>0 ? (
            <div>
              <p className="text-gray-500 text-xs font-semibold mb-2">🔗 Depends On ({deps.length})</p>
              <div className="space-y-2">
                {deps.map(dep=>(
                  <div key={dep.id} className="flex items-center gap-3 bg-gray-100 rounded-xl px-3 py-2.5">
                    <StatusBadge status={dep.status}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 text-xs font-semibold truncate">{dep.title}</p>
                      <p className="text-gray-400 text-xs">{dep.category}</p>
                    </div>
                    {dep.status!=='completed'&&<span className="text-amber-500 text-xs">⚠️ Pending</span>}
                  </div>
                ))}
              </div>
            </div>
          ) : null
        })()}

        {/* Expenses */}
        <div>
          {/* Summary row */}
          {task.expenses?.length>0&&(()=>{
            const paid    = task.expenses.filter(e=>e.status==='paid').reduce((s,e)=>s+e.amount,0)
            const planned = task.expenses.filter(e=>e.status==='planned').reduce((s,e)=>s+e.amount,0)
            return (
              <div className="bg-gray-100 rounded-2xl p-3 mb-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-gray-400 text-xs">Allocated</p>
                  <p className="text-gray-800 font-bold text-sm">{fmtINR(paid+planned)}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">Paid</p>
                  <p className="text-green-600 font-bold text-sm">{fmtINR(paid)}</p>
                </div>
                <div>
                  <p className="text-gray-400 text-xs">Planned</p>
                  <p className="text-amber-500 font-bold text-sm">{fmtINR(planned)}</p>
                </div>
              </div>
            )
          })()}

          <p className="text-gray-500 text-xs font-semibold mb-2">Expenses</p>
          {task.expenses?.length>0 ? (
            <div className="space-y-2">
              {task.expenses.map(e=>(
                <div key={e.id} className={`rounded-xl border overflow-hidden ${
                  e.status==='paid'?'bg-green-500/5 border-green-200':'bg-amber-400/5 border-amber-200'
                }`}>
                  {editingExpId===e.id ? (
                    /* Edit mode */
                    <div className="p-3 space-y-2">
                      {/* Paid/Planned toggle */}
                      <div className="flex gap-2">
                        {['planned','paid'].map(s=>(
                          <button key={s} onClick={()=>setEditingExp(f=>({...f,status:s,account_id:s==='planned'?'':f.account_id}))}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                              editingExp.status===s
                                ? s==='paid'?'bg-green-500/20 border-green-500 text-green-600':'bg-amber-400/20 border-amber-400 text-amber-500'
                                : 'border-gray-200 text-gray-400'
                            }`}>
                            {s==='paid'?'✅ Paid':'🕐 Planned'}
                          </button>
                        ))}
                      </div>
                      {/* Account selector — shown when paid, required if accounts exist */}
                      {editingExp.status==='paid'&&(
                        <div>
                          <select value={editingExp.account_id||''} onChange={ev=>setEditingExp(f=>({...f,account_id:ev.target.value}))}
                            className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-800 text-xs focus:outline-none focus:border-blue-500">
                            <option value="">{catAccounts.length>0?'Select account paid from':'No accounts linked to this category'}</option>
                            {catAccounts.map(a=>(
                              <option key={a.id} value={a.id}>{a.name} — {fmtINR(a.live_balance||a.current_balance)}</option>
                            ))}
                          </select>
                          {catAccounts.length===0&&(
                            <p className="text-gray-400 text-xs mt-1">Link accounts to "{task.category}" in Finance → Accounts tab</p>
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <input type="number" value={editingExp.amount} onChange={e=>setEditingExp(f=>({...f,amount:e.target.value}))}
                          className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-800 text-xs focus:outline-none focus:border-blue-500"
                          placeholder="Amount"/>
                        <input type="date" value={editingExp.expense_date} onChange={e=>setEditingExp(f=>({...f,expense_date:e.target.value}))}
                          className="bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-800 text-xs focus:outline-none focus:border-blue-500"/>
                      </div>
                      <input value={editingExp.description} onChange={e=>setEditingExp(f=>({...f,description:e.target.value}))}
                        className="w-full bg-white border border-gray-300 rounded-lg px-2 py-1.5 text-gray-800 text-xs focus:outline-none focus:border-blue-500"
                        placeholder="Description"/>
                      <div className="flex gap-2">
                        <button onClick={()=>saveEditExp(e.id)} className="flex-1 bg-blue-600 text-gray-800 text-xs font-bold py-1.5 rounded-lg">Save</button>
                        <button onClick={()=>setEditingExpId(null)} className="px-3 text-gray-400 text-xs border border-gray-200 rounded-lg">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    /* View mode */
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <button onClick={()=>handleQuickToggle(e)}
                        title={e.status==='planned'?'Tap to mark as paid (select account)':'Tap to revert to planned'}
                        className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-lg transition-all ${
                          e.status==='paid'?'bg-green-500/20 text-green-600':'bg-amber-400/20 text-amber-500'
                        }`}>
                        {e.status==='paid'?'✅':'🕐'}
                      </button>
                      <div className="flex-1 min-w-0" onClick={()=>startEditExp(e)}>
                        <p className="text-gray-800 text-xs font-semibold">{fmtINR(e.amount)}</p>
                        <p className="text-gray-400 text-xs truncate">
                          {e.description||'—'} · {fmtShort(e.expense_date)}
                          {e.account_name&&<span className="text-blue-600"> · {e.account_name}</span>}
                        </p>
                      </div>
                      <button onClick={()=>startEditExp(e)} className="text-gray-400 hover:text-blue-600 text-xs flex-shrink-0">✏️</button>
                      <button onClick={()=>handleDeleteExp(e.id)} className="text-gray-400 hover:text-red-600 text-xl leading-none flex-shrink-0">×</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <p className="text-gray-400 text-xs italic">No expenses yet</p>}
          <button onClick={()=>setShowExp(true)}
            className="mt-3 w-full border border-dashed border-gray-200 text-gray-400 hover:text-gray-800 hover:border-blue-500 py-2.5 rounded-xl text-sm transition-all">
            + Add Expense
          </button>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button onClick={onEdit} className="flex-1 bg-blue-100 text-blue-600 font-semibold py-3 rounded-2xl text-sm">Edit</button>
          <button onClick={handleDelete} disabled={deleting} className="flex-1 bg-red-50 text-red-600 font-semibold py-3 rounded-2xl text-sm disabled:opacity-50">
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

// ── Budget Item Form ───────────────────────────────────────────────────────────

function BudgetItemForm({ item, accounts, onSave, onClose }) {
  const isEdit = !!item?.id
  const inp = "w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-400"
  const lbl = "block text-xs text-gray-400 font-semibold mb-1.5"
  const [form, setForm] = useState({
    name:           item?.name           || '',
    component:      item?.component      || '',
    category:       item?.category       || '',
    sub_category:   item?.sub_category   || '',
    planned_amount: item?.planned_amount != null ? String(item.planned_amount) : '',
    actual_amount:  item?.actual_amount  != null ? String(item.actual_amount)  : '',
    account_id:     item?.account_id     != null ? String(item.account_id)     : '',
    planned_date:   item?.planned_date   || '',
    notes:          item?.notes          || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    if (!form.name.trim()) return setError('Name is required')
    setSaving(true); setError('')
    const payload = {
      name:           form.name.trim(),
      component:      form.component.trim()    || null,
      category:       form.category.trim()     || null,
      sub_category:   form.sub_category.trim() || null,
      planned_amount: form.planned_amount !== '' ? (parseFloat(form.planned_amount) || 0) : null,
      actual_amount:  form.actual_amount  !== '' ? (parseFloat(form.actual_amount)  || 0) : null,
      account_id:     form.account_id ? parseInt(form.account_id) : null,
      planned_date:   form.planned_date || null,
      notes:          form.notes.trim() || null,
    }
    try {
      if (isEdit) await updateBudgetItem(item.id, payload)
      else        await createBudgetItem(payload)
      await onSave(); onClose()
    } catch(e) { setError(e.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="p-5 space-y-4">
      <div>
        <label className={lbl}>Name *</label>
        <input value={form.name} onChange={e=>set('name',e.target.value)} className={inp} placeholder="Budget item name" autoFocus/>
      </div>
      <div>
        <label className={lbl}>Component / Group</label>
        <input value={form.component} onChange={e=>set('component',e.target.value)} className={inp} placeholder="e.g. Civil Work, Equipment, NHB Subsidy"/>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Category</label>
          <input value={form.category} onChange={e=>set('category',e.target.value)} className={inp} placeholder="Category"/>
        </div>
        <div>
          <label className={lbl}>Sub Category</label>
          <input value={form.sub_category} onChange={e=>set('sub_category',e.target.value)} className={inp} placeholder="Sub category"/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Planned Amount (₹)</label>
          <input type="number" value={form.planned_amount} onChange={e=>set('planned_amount',e.target.value)} className={inp} placeholder="0" min="0"/>
        </div>
        <div>
          <label className={lbl}>Actual Amount (₹)</label>
          <input type="number" value={form.actual_amount} onChange={e=>set('actual_amount',e.target.value)} className={inp} placeholder="0" min="0"/>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Planned Date</label>
          <input type="date" value={form.planned_date} onChange={e=>set('planned_date',e.target.value)} className={inp}/>
        </div>
        <div>
          <label className={lbl}>Account</label>
          <select value={form.account_id} onChange={e=>set('account_id',e.target.value)} className={inp}>
            <option value="">— None —</option>
            {accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className={lbl}>Notes</label>
        <textarea value={form.notes} onChange={e=>set('notes',e.target.value)} className={`${inp} resize-none`} rows={2} placeholder="Optional notes"/>
      </div>
      {error && <p className="text-red-600 text-xs bg-red-50 rounded-xl p-3">{error}</p>}
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-green-600 text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 active:scale-[0.98] transition-all">
        {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Budget Item'}
      </button>
    </div>
  )
}

// ── Budget Tab ─────────────────────────────────────────────────────────────────

function BudgetTab() {
  const [items, setItems]       = useState([])
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [editId, setEditId]     = useState(null)
  const [editVal, setEditVal]   = useState('')
  const [saving, setSaving]     = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [formItem, setFormItem] = useState(null)
  // collapsed by default: undefined → collapsed; false → open
  const [collapsedComps, setCollapsedComps]  = useState({})
  const [collapsedCats, setCollapsedCats]    = useState({})
  const [collapsedSubs, setCollapsedSubs]    = useState({})

  const load = useCallback(async () => {
    const [b, a] = await Promise.all([getBudgetItems(), getFinanceAccounts()])
    setItems(b.data); setAccounts(a.data); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const totalPlanned = items.reduce((s, i) => s + (i.planned_amount || 0), 0)
  const totalActual  = items.reduce((s, i) => s + (i.actual_amount  || 0), 0)

  // Build component → category → sub_category → items tree (3 levels)
  const tree = {}
  items.forEach(item => {
    const comp = item.component || 'General'
    const cat  = item.category  || 'Uncategorized'
    const sub  = item.sub_category || '—'
    if (!tree[comp]) tree[comp] = {}
    if (!tree[comp][cat]) tree[comp][cat] = {}
    if (!tree[comp][cat][sub]) tree[comp][cat][sub] = []
    tree[comp][cat][sub].push(item)
  })

  async function saveActual(id) {
    const val = parseFloat(editVal)
    if (isNaN(val)) return setEditId(null)
    setSaving(true)
    try { await updateBudgetItem(id, { actual_amount: val >= 0 ? val : null }); await load() }
    finally { setSaving(false); setEditId(null) }
  }

  async function handleDelete(item) {
    if (!confirm(`Delete "${item.name}"?`)) return
    try { await deleteBudgetItem(item.id); await load() }
    catch(e) { alert(e.response?.data?.detail || 'Delete failed') }
  }

  function openEdit(item) { setFormItem(item); setEditId(null); setShowForm(true) }
  function openAdd()      { setFormItem(null); setShowForm(true) }

  const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]))

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  return (
    <>
      <div className="p-4 pb-28 space-y-3">
        {/* Totals + Add button */}
        <div className="flex items-center gap-2">
          <div className="flex-1 grid grid-cols-3 gap-2">
            {[
              ['Planned', fmtINR(totalPlanned), 'text-gray-900'],
              ['Actual',  fmtINR(totalActual),  'text-green-700'],
              ['Variance', fmtINR(Math.abs(totalPlanned - totalActual)), totalPlanned - totalActual < 0 ? 'text-red-600' : 'text-blue-600'],
            ].map(([l, v, c]) => (
              <div key={l} className="bg-white border border-gray-200 rounded-2xl p-3 text-center">
                <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">{l}</p>
                <p className={`font-bold text-base mt-0.5 tabular-nums ${c}`}>{v}</p>
              </div>
            ))}
          </div>
          <button onClick={openAdd}
            className="bg-green-600 text-white text-xs font-bold px-3 py-2 rounded-xl flex-shrink-0 h-fit">
            + Add
          </button>
        </div>

        {items.length === 0 && (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📒</p>
            <p className="text-gray-400 text-sm mb-4">No budget items yet</p>
            <button onClick={openAdd} className="bg-green-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">
              + Add First Item
            </button>
          </div>
        )}

        {/* Component → Category → Sub-category → Items (3-level collapsible, collapsed by default) */}
        {Object.entries(tree).map(([comp, cats]) => {
          const compItems = Object.values(cats).flatMap(subs => Object.values(subs).flat())
          const compPlanned = compItems.reduce((s, i) => s + (i.planned_amount || 0), 0)
          const compActual  = compItems.reduce((s, i) => s + (i.actual_amount  || 0), 0)
          const compOpen = collapsedComps[comp] === false

          return (
            <div key={comp} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
              {/* Level 1 — Component (dark green) */}
              <button
                onClick={() => setCollapsedComps(p => ({ ...p, [comp]: compOpen ? undefined : false }))}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-green-700">
                <span className="text-white font-bold text-sm">{comp}</span>
                <div className="flex items-center gap-2">
                  <span className="text-green-200 text-[10px]">{fmtINR(compPlanned)}{compActual > 0 ? ` · ${fmtINR(compActual)} spent` : ''}</span>
                  <span className="text-white text-xs">{compOpen ? '▼' : '▶'}</span>
                </div>
              </button>

              {compOpen && (
                <div className="divide-y divide-gray-100">
                  {Object.entries(cats).map(([cat, subs]) => {
                    const catItems = Object.values(subs).flat()
                    const catPlanned = catItems.reduce((s, i) => s + (i.planned_amount || 0), 0)
                    const catActual  = catItems.reduce((s, i) => s + (i.actual_amount  || 0), 0)
                    const catKey = `${comp}||${cat}`
                    const catOpen = collapsedCats[catKey] === false

                    return (
                      <div key={cat}>
                        {/* Level 2 — Category (medium green) */}
                        <button
                          onClick={() => setCollapsedCats(p => ({ ...p, [catKey]: catOpen ? undefined : false }))}
                          className="w-full flex items-center justify-between px-4 py-2 bg-green-50 border-b border-green-100">
                          <span className="text-green-900 font-semibold text-xs">{cat}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-green-600 text-[10px]">{fmtINR(catPlanned)}{catActual > 0 ? ` · ${fmtINR(catActual)}` : ''}</span>
                            <span className="text-green-700 text-xs">{catOpen ? '▼' : '▶'}</span>
                          </div>
                        </button>

                        {catOpen && (
                          <div className="divide-y divide-gray-50">
                            {Object.entries(subs).map(([sub, subItems]) => {
                              const subKey = `${comp}||${cat}||${sub}`
                              const subPlanned = subItems.reduce((s, i) => s + (i.planned_amount || 0), 0)
                              const subActual  = subItems.reduce((s, i) => s + (i.actual_amount  || 0), 0)
                              const subOpen = collapsedSubs[subKey] === false
                              const showSubHeader = sub !== '—'

                              return (
                                <div key={sub}>
                                  {/* Level 3 — Sub-category (light gray, only if named) */}
                                  {showSubHeader && (
                                    <button
                                      onClick={() => setCollapsedSubs(p => ({ ...p, [subKey]: subOpen ? undefined : false }))}
                                      className="w-full flex items-center justify-between px-5 py-1.5 bg-gray-50 border-b border-gray-100">
                                      <span className="text-gray-600 font-medium text-[11px]">{sub}</span>
                                      <div className="flex items-center gap-2">
                                        <span className="text-gray-400 text-[10px]">{fmtINR(subPlanned)}{subActual > 0 ? ` · ${fmtINR(subActual)}` : ''}</span>
                                        <span className="text-gray-500 text-[10px]">{subOpen ? '▼' : '▶'}</span>
                                      </div>
                                    </button>
                                  )}

                                  {/* Items — show if sub has no header (single level) or sub is open */}
                                  {(!showSubHeader || subOpen) && (
                                    <div className="divide-y divide-gray-100">
                                      {subItems.map(item => {
                                        const variance = (item.planned_amount || 0) - (item.actual_amount || 0)
                                        const editing = editId === item.id
                                        return (
                                          <div key={item.id} className="px-4 py-3 space-y-1">
                                            <div className="flex items-start justify-between gap-2">
                                              <div className="flex-1 min-w-0">
                                                <p className="text-gray-800 text-xs font-semibold leading-snug">{item.name}</p>
                                                {item.planned_date && (
                                                  <p className="text-gray-400 text-[10px] mt-0.5">{fmtDate(item.planned_date)}</p>
                                                )}
                                              </div>
                                              <div className="text-right flex-shrink-0 space-y-0.5">
                                                <p className="text-gray-800 text-xs font-semibold tabular-nums">{fmtINR(item.planned_amount)}</p>
                                                {editing ? (
                                                  <input
                                                    autoFocus type="number" value={editVal}
                                                    onChange={e => setEditVal(e.target.value)}
                                                    onBlur={() => saveActual(item.id)}
                                                    onKeyDown={e => { if (e.key==='Enter') saveActual(item.id); if (e.key==='Escape') setEditId(null) }}
                                                    className="w-24 bg-gray-100 border border-blue-500 rounded-lg px-2 py-0.5 text-gray-800 text-xs focus:outline-none text-right"
                                                    disabled={saving}
                                                  />
                                                ) : (
                                                  <button
                                                    onClick={() => { setEditId(item.id); setEditVal(item.actual_amount != null ? String(item.actual_amount) : '') }}
                                                    className={`text-xs px-2 py-0.5 rounded-lg ${item.actual_amount != null ? 'text-green-600 bg-green-50' : 'text-gray-400 bg-gray-100'}`}>
                                                    {item.actual_amount != null ? fmtINR(item.actual_amount) : '+ actual'}
                                                  </button>
                                                )}
                                                {item.actual_amount != null && (
                                                  <p className={`text-[10px] font-semibold ${variance < 0 ? 'text-red-600' : 'text-blue-600'}`}>
                                                    {variance < 0 ? '▲' : '▼'} {fmtINR(Math.abs(variance))}
                                                  </p>
                                                )}
                                              </div>
                                              <div className="flex flex-col gap-1 flex-shrink-0 ml-1">
                                                <button onClick={() => openEdit(item)} className="text-gray-300 hover:text-blue-600 text-xs leading-none px-1">✏️</button>
                                                <button onClick={() => handleDelete(item)} className="text-gray-300 hover:text-red-500 text-base leading-none px-1">×</button>
                                              </div>
                                            </div>
                                            {(item.account_name || (item.account_id && accountMap[item.account_id])) && (
                                              <p className="text-gray-400 text-[10px]">🏦 {item.account_name || accountMap[item.account_id]}</p>
                                            )}
                                            {item.notes && <p className="text-gray-400 text-[10px] italic">{item.notes}</p>}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <BottomSheet show={showForm} onClose={()=>setShowForm(false)} title={formItem ? 'Edit Budget Item' : 'Add Budget Item'}>
        <BudgetItemForm
          item={formItem}
          accounts={accounts}
          onSave={load}
          onClose={()=>setShowForm(false)}
        />
      </BottomSheet>
    </>
  )
}

// ── Key dates (static) ─────────────────────────────────────────────────────────

const KEY_DATES = [
  { label: 'Bank sanction',       date: '2026-08-17' },
  { label: 'NHB approval target', date: '2026-10-15' },
  { label: 'Construction start',  date: '2026-11-01' },
  { label: 'Construction end',    date: '2027-02-28' },
  { label: 'Plantation start',    date: '2027-03-01' },
  { label: 'First harvest',       date: '2027-05-01' },
]

// ── Home Tab ───────────────────────────────────────────────────────────────────

function HomeTab({ tasks, summary, accounts, onTaskClick }) {
  const today = new Date(new Date().toDateString())
  const in7days = new Date(today); in7days.setDate(today.getDate()+7)
  const root = tasks.filter(t=>!t.parent_id)
  const [focusOpen, setFocusOpen]     = useState(false)
  const [comingOpen, setComingOpen]   = useState(false)
  const [budgetItems, setBudgetItems] = useState([])
  useEffect(() => { getBudgetItems().then(r => setBudgetItems(r.data)).catch(()=>{}) }, [])

  // Overdue in-progress tasks
  const overdueTasks = root.filter(t=>t.status==='in_progress'&&isOverdue(t))
  // In-progress, not overdue
  const activeTasks  = root.filter(t=>t.status==='in_progress'&&!isOverdue(t))
  // Not started, starting within 7 days
  const upcoming = root.filter(t=>{
    if (t.status!=='not_started'||!t.start_date) return false
    const sd = new Date(t.start_date+'T00:00:00')
    return sd>=today && sd<=in7days
  }).sort((a,b)=>new Date(a.start_date)-new Date(b.start_date))

  const totalOngoing   = overdueTasks.length + activeTasks.length
  const today_str      = today.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'short'})

  const byStatus = summary?.by_status || {}
  const total    = summary?.total || 0
  const completed = byStatus.completed || 0
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const totalAvail = accounts.reduce((s, a) => s + (a.live_balance ?? a.current_balance ?? 0), 0)
  const totalSpent = budgetItems.reduce((s, i) => s + (i.actual_amount || 0), 0)
  const totalPlanned = budgetItems.reduce((s, i) => s + (i.planned_amount || 0), 0)

  // Reusable card components for the key date and budget sections
  const KeyDatesCard = (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm h-fit">
      <div className="px-4 py-2.5 bg-green-700 flex items-center gap-2">
        <span className="text-white text-sm">📅</span>
        <p className="text-white text-xs font-bold tracking-wide">KEY DATES</p>
      </div>
      <div className="divide-y divide-gray-100">
        {KEY_DATES.map(({ label, date }) => {
          const isPast = new Date(date) < new Date()
          const isNext = !isPast && KEY_DATES.find(d => new Date(d.date) >= new Date())?.date === date
          return (
            <div key={label} className={`flex items-center justify-between px-4 py-2.5 ${isNext ? 'bg-blue-50' : ''}`}>
              <div className="flex items-center gap-2">
                {isNext && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0"/>}
                <span className={`text-xs font-medium ${isPast ? 'text-gray-400' : 'text-gray-800'}`}>{label}</span>
              </div>
              <span className={`text-xs font-bold ${isPast ? 'text-gray-400' : isNext ? 'text-blue-600' : 'text-gray-600'}`}>
                {new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )

  const BudgetCard = (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm h-fit">
      <div className="px-4 py-2.5 bg-green-700 flex items-center gap-2">
        <span className="text-white text-sm">💰</span>
        <p className="text-white text-xs font-bold tracking-wide">BUDGET SNAPSHOT</p>
      </div>
      <div className="grid grid-cols-3 divide-x divide-gray-100">
        <div className="p-3 text-center">
          <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">Planned</p>
          <p className="text-gray-900 font-bold text-base mt-0.5 tabular-nums">{fmtINR(totalPlanned)}</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">Spent</p>
          <p className="text-green-700 font-bold text-base mt-0.5 tabular-nums">{fmtINR(totalSpent)}</p>
        </div>
        <div className="p-3 text-center">
          <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">Funds Avail</p>
          <p className={`font-bold text-base mt-0.5 tabular-nums ${totalAvail > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{fmtINR(totalAvail)}</p>
        </div>
      </div>
      {/* Progress bar inside budget card */}
      <div className="px-4 pb-4 pt-2">
        <div className="flex items-center justify-between mb-1">
          <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">Overall Progress</p>
          <span className="text-green-700 font-extrabold text-lg tabular-nums">{pct}%</span>
        </div>
        <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-green-700 to-green-400 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-gray-400 text-[10px] mt-1">{completed} of {total} tasks completed</p>
      </div>
    </div>
  )

  return (
    <div className="p-4 pb-28 space-y-4">

      {/* ── Date strip ── */}
      <div className="flex items-center justify-between">
        <p className="text-gray-500 text-xs font-semibold">{today_str}</p>
        <div className="flex items-center gap-2">
          {totalOngoing>0&&(
            <span className="bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">{totalOngoing} in progress</span>
          )}
          {overdueTasks.length>0&&(
            <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">⚠ {overdueTasks.length} overdue</span>
          )}
        </div>
      </div>

      {/* ── Row 1: KPI chips (always full width, 4 cols) ── */}
      <div className="grid grid-cols-4 gap-2">
        {[
          ['✅', 'Done',    completed,                 'text-green-700',  'bg-green-50  border-green-200'],
          ['🔄', 'Active',  byStatus.in_progress || 0, 'text-blue-600',   'bg-blue-50   border-blue-200'],
          ['⚠️', 'On Hold', byStatus.on_hold || 0,     'text-amber-700',  'bg-amber-50  border-amber-200'],
          ['⏳', 'Pending', byStatus.not_started || 0, 'text-gray-600',   'bg-gray-100  border-gray-200'],
        ].map(([icon, label, val, cls, bg]) => (
          <div key={label} className={`${bg} border rounded-xl p-2 text-center shadow-sm`}>
            <span className="text-base">{icon}</span>
            <p className={`font-extrabold text-lg mt-0.5 tabular-nums ${cls}`}>{val}</p>
            <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {/* ── Row 2: Key Dates | Budget — side by side on sm+ ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {KeyDatesCard}
        {BudgetCard}
      </div>

      {/* ── Today's Focus ── */}
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm">
        <button className="w-full flex items-center justify-between px-4 py-3"
          onClick={()=>setFocusOpen(o=>!o)}>
          <div className="flex items-center gap-2">
            <h2 className="text-gray-800 font-bold text-sm">Today's Focus</h2>
            {totalOngoing>0&&(
              <span className="bg-blue-100 text-blue-600 text-xs font-bold px-2 py-0.5 rounded-full">{totalOngoing}</span>
            )}
            {overdueTasks.length>0&&(
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">⚠ {overdueTasks.length}</span>
            )}
          </div>
          <span className="text-gray-400 text-xs">{focusOpen?'▲':'▼'}</span>
        </button>

        {focusOpen&&(
          <div className="px-3 pb-3 space-y-2 border-t border-gray-100">
            {totalOngoing===0 ? (
              <div className="text-center py-4">
                <p className="text-2xl mb-1">✅</p>
                <p className="text-gray-400 text-sm">All clear — nothing in progress</p>
              </div>
            ) : (
              <>
                {overdueTasks.map(t=>{
                  const days = daysLeft(t.end_date)
                  const spent = t.total_expense||0
                  return (
                    <div key={t.id} onClick={()=>onTaskClick(t)}
                      className="border-l-4 border-l-red-500 bg-red-50 border border-red-100 rounded-xl p-3 cursor-pointer active:scale-[0.99] transition-all space-y-2 mt-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 font-semibold text-sm leading-snug">{t.title}</p>
                          {t.notes&&<p className="text-gray-400 text-xs mt-0.5 truncate">{t.notes}</p>}
                        </div>
                        <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0">{Math.abs(days)}d late</span>
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-500 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">{t.category}</span>
                        {t.end_date&&<span className="text-red-500 text-xs">📅 {fmtShort(t.end_date)}</span>}
                      </div>
                      {t.budget>0&&<BudgetBar budget={t.budget} spent={spent} compact/>}
                      <SubtaskPill subtasks={t.subtasks}/>
                    </div>
                  )
                })}

                {overdueTasks.length>0&&activeTasks.length>0&&(
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 h-px bg-gray-100"/>
                    <span className="text-gray-500 text-[10px] font-semibold uppercase tracking-wider">In Progress</span>
                    <div className="flex-1 h-px bg-gray-100"/>
                  </div>
                )}

                {activeTasks.map(t=>{
                  const days = daysLeft(t.end_date)
                  const spent = t.total_expense||0
                  return (
                    <div key={t.id} onClick={()=>onTaskClick(t)}
                      className="border-l-4 border-l-blue-500 bg-white border border-gray-100 rounded-xl p-3 cursor-pointer active:scale-[0.99] transition-all space-y-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800 font-semibold text-sm leading-snug">{t.title}</p>
                        {t.notes&&<p className="text-gray-400 text-xs mt-0.5 truncate">{t.notes}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-500 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full">{t.category}</span>
                        {t.end_date&&(
                          <span className={`text-xs ${days!=null&&days<=2?'text-amber-500':'text-gray-400'}`}>
                            📅 {fmtShort(t.end_date)}{days!=null&&days<=3?` · ${days}d left`:''}
                          </span>
                        )}
                      </div>
                      {t.budget>0&&<BudgetBar budget={t.budget} spent={spent} compact/>}
                      <SubtaskPill subtasks={t.subtasks}/>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Coming Up (7 days) ── */}
      {upcoming.length>0&&(
        <div className="bg-white border border-amber-200 rounded-2xl overflow-hidden shadow-sm">
          <button className="w-full flex items-center justify-between px-4 py-3"
            onClick={()=>setComingOpen(o=>!o)}>
            <div className="flex items-center gap-2">
              <h2 className="text-gray-800 font-bold text-sm">Coming Up</h2>
              <span className="text-gray-400 text-xs">next 7 days</span>
              <span className="bg-amber-100 text-amber-600 text-xs font-bold px-2 py-0.5 rounded-full">{upcoming.length}</span>
            </div>
            <span className="text-gray-400 text-xs">{comingOpen?'▲':'▼'}</span>
          </button>

          {comingOpen&&(
            <div className="px-3 pb-3 space-y-2 border-t border-gray-100">
              {upcoming.map(t=>{
                const days = daysLeft(t.start_date)
                return (
                  <div key={t.id} onClick={()=>onTaskClick(t)}
                    className="bg-amber-50 border border-amber-100 border-l-4 border-l-amber-500 rounded-xl p-3 cursor-pointer active:scale-[0.99] transition-all mt-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-800 font-semibold text-sm truncate">{t.title}</p>
                        <span className="text-gray-500 text-[10px] bg-gray-100 px-2 py-0.5 rounded-full mt-1 inline-block">{t.category}</span>
                      </div>
                      <span className="text-amber-600 text-xs font-semibold flex-shrink-0 text-right">
                        {days===0?'Starts today':days===1?'Tomorrow':`In ${days}d`}<br/>
                        <span className="text-gray-400 font-normal">{fmtShort(t.start_date)}</span>
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ── Tasks Tab ──────────────────────────────────────────────────────────────────

// ── Calendar View ─────────────────────────────────────────────────────────────

function CalendarView({ tasks, onTaskClick }) {
  const [cur, setCur] = useState(new Date())
  const [selDay, setSelDay] = useState(null)
  const yr = cur.getFullYear(), mo = cur.getMonth()
  const firstDay = new Date(yr, mo, 1)
  const lastDate = new Date(yr, mo+1, 0).getDate()
  const pad = firstDay.getDay() // 0=Sun
  const todayD = new Date(new Date().toDateString())

  const tasksByDay = {}
  tasks.filter(t=>!t.parent_id).forEach(t=>{
    if (!t.end_date) return
    const d = new Date(t.end_date+'T00:00:00')
    if (d.getFullYear()===yr && d.getMonth()===mo) {
      const k = d.getDate()
      if (!tasksByDay[k]) tasksByDay[k]=[]
      tasksByDay[k].push(t)
    }
  })

  const monthLabel = cur.toLocaleDateString('en-IN',{month:'long',year:'numeric'})
  const selTasks = selDay ? tasksByDay[selDay]||[] : []

  const STATUS_COLOR = { completed:'bg-green-500', in_progress:'bg-blue-600', on_hold:'bg-amber-400', not_started:'bg-[#8892B0]' }

  return (
    <div className="pb-6">
      {/* Month nav */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={()=>{setCur(new Date(yr,mo-1,1));setSelDay(null)}}
          className="w-9 h-9 flex items-center justify-center bg-white rounded-xl text-gray-800 text-lg">‹</button>
        <p className="text-gray-800 font-bold text-sm">{monthLabel}</p>
        <button onClick={()=>{setCur(new Date(yr,mo+1,1));setSelDay(null)}}
          className="w-9 h-9 flex items-center justify-center bg-white rounded-xl text-gray-800 text-lg">›</button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 px-4 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>(
          <p key={d} className="text-gray-400 text-xs text-center font-semibold py-1">{d}</p>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 px-4 gap-1">
        {Array(pad).fill(null).map((_,i)=><div key={`p${i}`}/>)}
        {Array(lastDate).fill(null).map((_,i)=>{
          const day = i+1
          const dayTasks = tasksByDay[day]||[]
          const isToday = new Date(yr,mo,day).getTime()===todayD.getTime()
          const sel = selDay===day
          const hasOverdue = dayTasks.some(isOverdue)
          return (
            <div key={day} onClick={()=>setSelDay(sel?null:day)}
              className={`rounded-xl p-1 cursor-pointer transition-all min-h-[46px] flex flex-col items-center gap-1 ${
                sel?'bg-blue-600/20 border border-blue-500/50':
                isToday?'bg-blue-50 border border-blue-300':
                'hover:bg-white border border-transparent'
              }`}>
              <p className={`text-xs font-bold leading-none pt-0.5 ${isToday?'text-blue-600':sel?'text-gray-800':'text-gray-400'}`}>{day}</p>
              {dayTasks.length>0&&(
                <div className="flex flex-wrap gap-0.5 justify-center">
                  {dayTasks.slice(0,4).map(t=>(
                    <div key={t.id} className={`w-1.5 h-1.5 rounded-full ${isOverdue(t)?'bg-red-500':STATUS_COLOR[t.status]||'bg-[#8892B0]'}`}/>
                  ))}
                  {dayTasks.length>4&&<div className="w-1.5 h-1.5 rounded-full bg-amber-400"/>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 px-4 mt-3 flex-wrap">
        {[['bg-blue-600','In Progress'],['bg-green-500','Completed'],['bg-amber-400','On Hold'],['bg-red-500','Overdue'],['bg-[#8892B0]','Not Started']].map(([c,l])=>(
          <div key={l} className="flex items-center gap-1"><div className={`w-2 h-2 rounded-full ${c}`}/><p className="text-gray-400 text-xs">{l}</p></div>
        ))}
      </div>

      {/* Selected day task list */}
      {selDay&&(
        <div className="px-4 mt-4 space-y-2">
          <p className="text-gray-500 text-xs font-semibold">{selTasks.length} task{selTasks.length!==1?'s':''} due {selDay} {monthLabel}</p>
          {selTasks.length===0
            ? <p className="text-gray-400 text-xs italic">No tasks due this day</p>
            : selTasks.map(t=>(
              <div key={t.id} onClick={()=>onTaskClick(t)}
                className={`border-l-4 ${PRI_BORDER[t.priority]||'border-l-gray-300'} bg-white border border-gray-200 rounded-xl px-3 py-2.5 cursor-pointer flex items-center gap-3`}>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 text-xs font-semibold truncate">{t.title}</p>
                  <p className="text-gray-400 text-xs">{t.category}</p>
                </div>
                <StatusBadge status={t.status}/>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── Timeline View ──────────────────────────────────────────────────────────────

function TimelineView({ tasks, onTaskClick }) {
  const root = tasks.filter(t=>!t.parent_id)

  // Build events: one entry per task, keyed by start_date (or end_date if no start)
  const events = []
  root.forEach(t=>{
    const anchor = t.start_date || t.end_date
    if (!anchor) return
    events.push({ dateStr: anchor, task: t })
  })
  events.sort((a,b)=>a.dateStr.localeCompare(b.dateStr))

  if (events.length===0) return (
    <div className="flex items-center justify-center py-20 text-gray-400 text-sm">No tasks with dates</div>
  )

  // Group by date
  const grouped = {}
  events.forEach(ev=>{
    if (!grouped[ev.dateStr]) grouped[ev.dateStr]=[]
    grouped[ev.dateStr].push(ev)
  })

  const today = new Date(new Date().toDateString())
  const todayStr = today.toISOString().split('T')[0]

  const TYPE_STYLE = {
    start:{ icon:'🚀', label:'Starts', color:'text-blue-600', dot:'bg-blue-600' },
    due:  { icon:'🏁', label:'Due',    color:'text-amber-500', dot:'bg-amber-400' },
  }

  return (
    <div className="px-4 pb-28 pt-4 space-y-0">
      {Object.entries(grouped).map(([dateStr, evs], gi)=>{
        const date = new Date(dateStr+'T00:00:00')
        const isToday = dateStr===todayStr
        const isPast  = date<today
        const dayLabel = date.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})
        return (
          <div key={dateStr} className="flex gap-3">
            {/* Spine */}
            <div className="flex flex-col items-center flex-shrink-0" style={{width:40}}>
              <div className={`w-3 h-3 rounded-full flex-shrink-0 mt-1 border-2 ${
                isToday?'bg-blue-600 border-blue-500':
                isPast?'bg-gray-200 border-gray-200':'bg-gray-100 border-[#8892B0]'
              }`}/>
              {gi<Object.keys(grouped).length-1&&<div className="w-0.5 flex-1 bg-gray-200 mt-1"/>}
            </div>

            {/* Content */}
            <div className="flex-1 pb-5 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <p className={`text-xs font-bold ${isToday?'text-blue-600':isPast?'text-gray-400':'text-gray-800'}`}>
                  {isToday?'Today · ':''}{dayLabel}
                </p>
                {isToday&&<span className="bg-blue-600 text-gray-800 text-xs px-1.5 py-0.5 rounded-full font-bold">TODAY</span>}
              </div>
              <div className="space-y-2">
                {evs.map((ev,ei)=>{
                  const over = isOverdue(ev.task)
                  const t = ev.task
                  const dateRange = t.start_date && t.end_date && t.start_date !== t.end_date
                    ? `${fmtDate(t.start_date)} → ${fmtDate(t.end_date)}`
                    : t.end_date ? `Due ${fmtDate(t.end_date)}` : `Starts ${fmtDate(t.start_date)}`
                  return (
                    <div key={`${t.id}-${ei}`} onClick={()=>onTaskClick(t)}
                      className={`border-l-4 ${PRI_BORDER[t.priority]||'border-l-gray-300'} rounded-xl p-3 cursor-pointer active:scale-[0.99] transition-all ${
                        over?'bg-red-50 border border-red-200':'bg-white border border-gray-200'
                      }`}>
                      <div className="flex items-start gap-2">
                        <span className="text-sm flex-shrink-0">{over?'⚠️':'📌'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-gray-800 text-xs font-semibold">{t.title}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <p className="text-gray-400 text-xs">{t.category}</p>
                            <p className={`text-xs font-medium ${over?'text-red-500':'text-blue-500'}`}>{over?'OVERDUE · ':''}{dateRange}</p>
                          </div>
                          <div className="mt-1"><StatusBadge status={t.status}/></div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Tasks Tab ──────────────────────────────────────────────────────────────────

function TasksTab({ tasks, categories, onTaskClick, onStatusChange, filterStatus, setFilterStatus, filterCat, setFilterCat }) {
  const [view, setView] = useState('list')
  const [search, setSearch] = useState('')
  const [collapsedPhases, setCollapsedPhases] = useState({})
  const root = tasks.filter(t=>!t.parent_id)
  const q = search.trim().toLowerCase()
  const filtered = root
    .filter(t=>filterStatus==='all'||t.status===filterStatus)
    .filter(t=>filterCat==='all'||t.category===filterCat)
    .filter(t=>!q || t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || (t.notes||'').toLowerCase().includes(q))

  const VIEWS = [
    {key:'list',     icon:'☰'},
    {key:'calendar', icon:'📅'},
    {key:'timeline', icon:'🕐'},
  ]
  const STATUSES = [
    {key:'all',         label:'All'},
    {key:'in_progress', label:'In Progress'},
    {key:'not_started', label:'Not Started'},
    {key:'on_hold',     label:'On Hold'},
    {key:'completed',   label:'Done'},
  ]

  return (
    <div className="pb-28">

      {/* ── Search + view switcher on one row ── */}
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-8 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-400"
            placeholder="Search tasks…"/>
          {search&&(
            <button onClick={()=>setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-800 text-lg leading-none">×</button>
          )}
        </div>
        {/* View icon buttons */}
        <div className="flex gap-1 flex-shrink-0">
          {VIEWS.map(v=>(
            <button key={v.key} onClick={()=>setView(v.key)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center text-base transition-all border ${
                view===v.key?'bg-blue-600 text-gray-800 border-blue-500':'bg-white text-gray-400 border-gray-200'
              }`}>
              {v.icon}
            </button>
          ))}
        </div>
      </div>

      {/* ── Two filter rows: status | category ── */}
      {!q&&(
        <div className="space-y-2 pb-3">
          {/* Row 1 — Status */}
          <div className="px-4 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
            {STATUSES.map(f=>(
              <button key={f.key} onClick={()=>setFilterStatus(f.key)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  filterStatus===f.key?'bg-blue-600 text-gray-800':'bg-white text-gray-400 border border-gray-200'
                }`}>{f.label}</button>
            ))}
          </div>
          {/* Row 2 — Category */}
          <div className="px-4 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
            <button onClick={()=>setFilterCat('all')}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                filterCat==='all'?'bg-[#A78BFA] text-gray-800':'bg-white text-gray-400 border border-gray-200'
              }`}>All</button>
            {categories.map(c=>(
              <button key={c} onClick={()=>setFilterCat(filterCat===c?'all':c)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  filterCat===c?'bg-[#A78BFA] text-gray-800':'bg-white text-gray-400 border border-gray-200'
                }`}>{c}</button>
            ))}
          </div>
        </div>
      )}

      {/* Search result hint */}
      {q&&(
        <div className="px-4 pb-2">
          <p className="text-gray-400 text-xs">{filtered.length} result{filtered.length!==1?'s':''} for "{search}"</p>
        </div>
      )}

      {/* Views */}
      {view==='list'&&(
        <div className="px-4 space-y-3">
          {filtered.length===0
            ? <div className="text-center py-16"><p className="text-4xl mb-3">{q?'🔍':'✅'}</p><p className="text-gray-400 text-sm">{q?'No tasks match your search':'No tasks match this filter'}</p></div>
            : (() => {
                // Group by category (phase)
                const phaseMap = {}
                filtered.forEach(t => {
                  const ph = t.category || 'Uncategorized'
                  if (!phaseMap[ph]) phaseMap[ph] = []
                  phaseMap[ph].push(t)
                })
                return Object.entries(phaseMap).map(([phase, pTasks]) => {
                  // collapsed by default (undefined → not explicitly opened)
                  const isCollapsed = collapsedPhases[phase] !== false
                  const done = pTasks.filter(t=>t.status==='completed').length
                  return (
                    <div key={phase}>
                      <button
                        onClick={() => setCollapsedPhases(p => ({ ...p, [phase]: !isCollapsed }))}
                        className="w-full flex items-center justify-between px-3 py-2 bg-green-700 rounded-xl mb-2">
                        <span className="text-white text-xs font-bold">{phase}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-green-200 text-[10px]">{done}/{pTasks.length}</span>
                          <span className="text-white text-xs">{isCollapsed ? '▶' : '▼'}</span>
                        </div>
                      </button>
                      {!isCollapsed && pTasks.map(t =>
                        <TaskCard key={t.id} task={t} onClick={onTaskClick} onStatusChange={onStatusChange}/>
                      )}
                    </div>
                  )
                })
              })()
          }
        </div>
      )}

      {view==='calendar' && <CalendarView tasks={filtered} onTaskClick={onTaskClick}/>}
      {view==='timeline' && <TimelineView tasks={filtered} onTaskClick={onTaskClick}/>}
    </div>
  )
}

// ── Finance Tab (Project Financials) ──────────────────────────────────────────


function AddFundsForm({ account, onSave, onClose }) {
  const inp = "w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-800 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-400"
  const lbl = "block text-xs text-gray-400 font-semibold mb-1.5"
  const [form, setForm] = useState({
    amount: '',
    description: '',
    source_type: 'Own Contribution',
    received_date: new Date().toISOString().split('T')[0],
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSave() {
    const amount = parseFloat(form.amount)
    if (isNaN(amount) || amount <= 0) return setError('Enter a valid amount')
    setSaving(true); setError('')
    const desc = [form.source_type, form.description].filter(Boolean).join(' — ')
    try {
      await createFinanceReceipt({
        account_id: account.id,
        amount,
        description: desc || null,
        received_date: form.received_date,
        source_id: null,
      })
      await onSave(); onClose()
    } catch(e) { setError(e.response?.data?.detail || 'Save failed') }
    finally { setSaving(false) }
  }

  const SOURCE_TYPES = ['Own Contribution', 'Bank Loan', 'NHB Subsidy', 'Grant', 'Other']

  return (
    <div className="p-5 space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-2xl p-3">
        <p className="text-green-600 text-[10px] font-bold uppercase">Adding funds to</p>
        <p className="text-gray-800 font-bold text-sm mt-0.5">{account.name}</p>
      </div>
      <div>
        <label className={lbl}>Source Type</label>
        <div className="flex flex-wrap gap-2">
          {SOURCE_TYPES.map(s => (
            <button key={s} onClick={() => set('source_type', s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${
                form.source_type === s ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-400 border-gray-200'
              }`}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={lbl}>Amount (₹) *</label>
          <input type="number" value={form.amount} onChange={e => set('amount', e.target.value)}
            className={inp} placeholder="0" min="0" autoFocus/>
        </div>
        <div>
          <label className={lbl}>Date *</label>
          <input type="date" value={form.received_date} onChange={e => set('received_date', e.target.value)} className={inp}/>
        </div>
      </div>
      <div>
        <label className={lbl}>Description / Note</label>
        <input value={form.description} onChange={e => set('description', e.target.value)}
          className={inp} placeholder="e.g. Tranche 1, Phase 2 release"/>
      </div>
      {error && <p className="text-red-600 text-xs bg-red-50 rounded-xl p-3">{error}</p>}
      <button onClick={handleSave} disabled={saving}
        className="w-full bg-green-600 text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 active:scale-[0.98] transition-all">
        {saving ? 'Saving…' : `Add ${form.source_type}`}
      </button>
    </div>
  )
}

function FinanceTab() {
  const [accounts, setAccounts] = useState([])
  const [budgetItems, setBudgetItems] = useState([])
  const [receipts, setReceipts] = useState([])
  const [loading, setLoading] = useState(true)
  const [subtab, setSubtab] = useState('accounts')
  const [addFundsFor, setAddFundsFor] = useState(null) // account object
  const [expandedInflows, setExpandedInflows] = useState({}) // {accountId: bool}
  const [expandedMonths, setExpandedMonths] = useState({})  // {month: bool}

  const load = useCallback(async () => {
    const [a, b, r] = await Promise.all([getFinanceAccounts(), getBudgetItems(), getFinanceReceipts()])
    setAccounts(a.data); setBudgetItems(b.data); setReceipts(r.data); setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  function toggleInflows(id) {
    setExpandedInflows(prev => ({ ...prev, [id]: !prev[id] }))
  }

  async function handleDeleteReceipt(id) {
    if (!confirm('Remove this fund inflow?')) return
    try { await deleteFinanceReceipt(id); await load() }
    catch(e) { alert(e.response?.data?.detail || 'Delete failed') }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const cashFlowMonths = (() => {
    const map = {}
    budgetItems.forEach(item => {
      if (!item.planned_date) return
      const m = item.planned_date.slice(0, 7)
      if (!map[m]) map[m] = { planned: 0, actual: 0 }
      map[m].planned += item.planned_amount || 0
      map[m].actual  += item.actual_amount  || 0
    })
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({
      month,
      label: new Date(month + '-01').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
      planned: v.planned,
      actual:  v.actual,
    }))
  })()

  const maxFlow = Math.max(...cashFlowMonths.map(m => m.planned), 1)

  const SUBTABS = [
    { key: 'accounts', label: 'Accounts' },
    { key: 'cashflow', label: 'Cash Flow' },
  ]

  return (
    <div className="pb-28">
      <div className="px-4 pt-4 pb-3 flex gap-2">
        {SUBTABS.map(s => (
          <button key={s.key} onClick={() => setSubtab(s.key)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
              subtab === s.key ? 'bg-blue-100 text-blue-600' : 'bg-white border border-gray-200 text-gray-400'
            }`}>
            {s.label}
          </button>
        ))}
      </div>

      {subtab === 'accounts' && (
        <div className="px-4 space-y-4">
          {accounts.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-12">No accounts found.</p>
          )}
          {accounts.map(a => {
            const live      = a.live_balance != null ? a.live_balance : (a.current_balance || 0)
            const acctItems = budgetItems.filter(i => i.account_id === a.id)
            const proposed  = acctItems.reduce((s, i) => s + (i.planned_amount || 0), 0)
            const spent     = acctItems.reduce((s, i) => s + (i.actual_amount  || 0), 0)
            const remaining = live - (proposed - spent)
            const sufficient = (live + spent) >= proposed
            const spentPct  = proposed > 0 ? Math.min((spent / proposed) * 100, 100) : 0
            const acctReceipts = receipts.filter(r => r.account_id === a.id)
              .sort((x, y) => y.received_date?.localeCompare(x.received_date))
            const inflowsOpen = expandedInflows[a.id]
            return (
              <div key={a.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {/* Account header */}
                <div className="flex items-center justify-between px-4 py-3 bg-green-700">
                  <div>
                    <p className="text-white text-[10px] font-bold uppercase">Account</p>
                    <p className="text-white font-bold text-base">{a.name}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${sufficient ? 'bg-white/20 text-white' : 'bg-red-100 text-red-600'}`}>
                    {sufficient ? '✓ Sufficient' : '⚠ Shortfall'}
                  </span>
                </div>

                {/* KPI grid */}
                <div className="grid grid-cols-2 divide-x divide-y divide-gray-200">
                  {[
                    ['Funds Available', fmtINR(live),               'text-gray-900'],
                    ['Proposed Expense',fmtINR(proposed),           'text-gray-500'],
                    ['Spent',           fmtINR(spent),               'text-green-700'],
                    [remaining < 0 ? 'Shortfall' : 'Surplus', fmtINR(Math.abs(remaining)), remaining < 0 ? 'text-red-600' : 'text-blue-600'],
                  ].map(([lbl, val, cls]) => (
                    <div key={lbl} className="p-3 text-center">
                      <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">{lbl}</p>
                      <p className={`font-bold text-base mt-0.5 tabular-nums ${cls}`}>{val}</p>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                {proposed > 0 && (
                  <div className="px-4 pt-1 pb-3">
                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                      <span>Spent {spentPct.toFixed(0)}% of proposed</span>
                      <span>{fmtINR(proposed - spent)} remaining</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${spentPct >= 100 ? 'bg-red-500' : spentPct > 80 ? 'bg-amber-400' : 'bg-green-500'}`}
                        style={{ width: `${spentPct}%` }} />
                    </div>
                  </div>
                )}

                {/* Fund Inflows section */}
                <div className="border-t border-gray-100">
                  <button onClick={() => toggleInflows(a.id)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-600">💵 Funds Received</span>
                      {acctReceipts.length > 0 && (
                        <span className="bg-green-100 text-green-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                          {acctReceipts.length} · {fmtINR(acctReceipts.reduce((s, r) => s + r.amount, 0))}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={e => { e.stopPropagation(); setAddFundsFor(a) }}
                        className="bg-green-600 text-white text-[10px] font-bold px-2.5 py-1 rounded-lg">
                        + Add
                      </button>
                      <span className="text-gray-300 text-xs">{inflowsOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {inflowsOpen && (
                    <div className="px-4 pb-3 space-y-2">
                      {acctReceipts.length === 0 ? (
                        <p className="text-gray-400 text-xs italic py-2">No funds recorded yet. Tap "+ Add" to log a receipt.</p>
                      ) : (
                        acctReceipts.map(r => (
                          <div key={r.id} className="flex items-center gap-3 bg-green-50 border border-green-100 rounded-xl px-3 py-2.5">
                            <div className="flex-1 min-w-0">
                              <p className="text-white text-xs font-semibold">{fmtINR(r.amount)}</p>
                              <p className="text-gray-500 text-[10px] truncate">
                                {r.description || '—'} · {fmtShort(r.received_date)}
                              </p>
                            </div>
                            <button onClick={() => handleDeleteReceipt(r.id)}
                              className="text-gray-300 hover:text-red-500 text-lg leading-none flex-shrink-0">×</button>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {accounts.length > 1 && (() => {
            const totLive  = accounts.reduce((s, a) => s + (a.live_balance != null ? a.live_balance : (a.current_balance || 0)), 0)
            const totAlloc = accounts.reduce((s, a) => s + budgetItems.filter(i => i.account_id === a.id).reduce((t, i) => t + (i.planned_amount || 0), 0), 0)
            const totPaid  = accounts.reduce((s, a) => s + budgetItems.filter(i => i.account_id === a.id).reduce((t, i) => t + (i.actual_amount  || 0), 0), 0)
            return (
              <div className="bg-white border border-green-100 rounded-2xl overflow-hidden">
                <div className="px-4 py-2 bg-green-700">
                  <p className="text-white text-[10px] font-bold">TOTAL — ALL ACCOUNTS</p>
                </div>
                <div className="grid grid-cols-3 divide-x divide-gray-200">
                  {[
                    ['Available', fmtINR(totLive),  'text-gray-900'],
                    ['Proposed',  fmtINR(totAlloc), 'text-gray-500'],
                    ['Spent',     fmtINR(totPaid),  'text-green-700'],
                  ].map(([lbl, val, cls]) => (
                    <div key={lbl} className="p-3 text-center">
                      <p className="text-gray-500 text-[10px] font-semibold uppercase tracking-wide">{lbl}</p>
                      <p className={`font-bold text-base mt-0.5 tabular-nums ${cls}`}>{val}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      <BottomSheet show={!!addFundsFor} onClose={() => setAddFundsFor(null)}
        title={addFundsFor ? `Add Funds — ${addFundsFor.name}` : ''}>
        {addFundsFor && <AddFundsForm account={addFundsFor} onSave={load} onClose={() => setAddFundsFor(null)}/>}
      </BottomSheet>

      {subtab === 'cashflow' && (
        <div className="px-4 space-y-3">
          <p className="text-gray-400 text-xs">Monthly outflow from budget line items</p>
          {cashFlowMonths.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-12">No budget items with dates.</p>
          )}
          {cashFlowMonths.map(({ month, label, planned, actual }) => {
            const barPct = maxFlow > 0 ? (planned / maxFlow) * 100 : 0
            const actPct = planned > 0 ? Math.min((actual / planned) * 100, 100) : 0
            const isCurrent = month === new Date().toISOString().slice(0, 7)
            const isOpen = !!expandedMonths[month]

            // Gather inflows and outflows for this month
            const monthReceipts = receipts.filter(r => r.received_date && r.received_date.slice(0, 7) === month)
            const monthItems    = budgetItems.filter(i => i.planned_date && i.planned_date.slice(0, 7) === month)

            // Group by account
            const acctIds = [...new Set([
              ...monthReceipts.map(r => r.account_id),
              ...monthItems.map(i => i.account_id),
            ])].filter(Boolean)
            const unlinked = { receipts: monthReceipts.filter(r => !r.account_id), items: monthItems.filter(i => !i.account_id) }

            const totalIn  = monthReceipts.reduce((s, r) => s + (r.amount || 0), 0)
            const totalOut = monthItems.reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0)

            return (
              <div key={month} className={`bg-white border rounded-2xl overflow-hidden ${isCurrent ? 'border-blue-300' : 'border-gray-200'}`}>
                {/* Header — tap to expand */}
                <button
                  className="w-full p-4 text-left space-y-2"
                  onClick={() => setExpandedMonths(p => ({ ...p, [month]: !p[month] }))}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-gray-800 text-sm font-bold">{label}</span>
                      {isCurrent && <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold">NOW</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-800 text-sm font-bold">{fmtINR(planned)}</span>
                      <span className="text-gray-400 text-xs">{isOpen ? '▲' : '▼'}</span>
                    </div>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-600/40 rounded-full" style={{ width: `${barPct}%` }} />
                  </div>
                  {actual > 0 ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-gray-400">
                        <span>Actual: <span className="text-green-600 font-semibold">{fmtINR(actual)}</span></span>
                        <span>{actPct.toFixed(0)}% of planned</span>
                      </div>
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${actPct >= 100 ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${actPct}%` }} />
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 text-[10px]">No actuals yet</p>
                  )}
                  {/* Mini summary row */}
                  {(totalIn > 0 || totalOut > 0) && (
                    <div className="flex gap-3 pt-0.5">
                      {totalIn > 0 && <span className="text-[10px] text-green-600 font-semibold">↑ {fmtINR(totalIn)} in</span>}
                      {totalOut > 0 && <span className="text-[10px] text-red-500 font-semibold">↓ {fmtINR(totalOut)} out</span>}
                    </div>
                  )}
                </button>

                {/* Expandable detail */}
                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {acctIds.map(aid => {
                      const acctName = (monthReceipts.find(r => r.account_id === aid) || monthItems.find(i => i.account_id === aid))?.account_name || `Account ${aid}`
                      const aIn  = monthReceipts.filter(r => r.account_id === aid)
                      const aOut = monthItems.filter(i => i.account_id === aid)
                      const netIn  = aIn.reduce((s, r) => s + (r.amount || 0), 0)
                      const netOut = aOut.reduce((s, i) => s + (i.actual_amount || i.planned_amount || 0), 0)
                      return (
                        <div key={aid} className="px-4 py-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-700">🏦 {acctName}</span>
                            <div className="flex gap-2 text-[10px]">
                              {netIn  > 0 && <span className="text-green-600 font-semibold">+{fmtINR(netIn)}</span>}
                              {netOut > 0 && <span className="text-red-500 font-semibold">−{fmtINR(netOut)}</span>}
                            </div>
                          </div>
                          {/* Inflows */}
                          {aIn.map(r => (
                            <div key={`in-${r.id}`} className="flex justify-between items-start pl-3">
                              <div>
                                <p className="text-[11px] text-green-700 font-medium">↑ {r.source_name || 'Inflow'}</p>
                                {r.description && <p className="text-[10px] text-gray-400">{r.description}</p>}
                                <p className="text-[10px] text-gray-400">{r.received_date}</p>
                              </div>
                              <span className="text-[11px] text-green-600 font-semibold whitespace-nowrap ml-2">{fmtINR(r.amount)}</span>
                            </div>
                          ))}
                          {/* Outflows */}
                          {aOut.map(i => (
                            <div key={`out-${i.id}`} className="flex justify-between items-start pl-3">
                              <div>
                                <p className="text-[11px] text-red-600 font-medium">↓ {i.name}</p>
                                {i.category && <p className="text-[10px] text-gray-400">{i.category}{i.sub_category ? ` › ${i.sub_category}` : ''}</p>}
                                <p className="text-[10px] text-gray-400">{i.planned_date} {i.actual_amount ? '· paid' : '· planned'}</p>
                              </div>
                              <span className="text-[11px] text-red-500 font-semibold whitespace-nowrap ml-2">{fmtINR(i.actual_amount || i.planned_amount)}</span>
                            </div>
                          ))}
                        </div>
                      )
                    })}
                    {/* Unlinked items (no account) */}
                    {(unlinked.receipts.length > 0 || unlinked.items.length > 0) && (
                      <div className="px-4 py-3 space-y-2">
                        <span className="text-xs font-bold text-gray-500">No account linked</span>
                        {unlinked.receipts.map(r => (
                          <div key={`in-${r.id}`} className="flex justify-between items-start pl-3">
                            <div>
                              <p className="text-[11px] text-green-700 font-medium">↑ {r.source_name || 'Inflow'}</p>
                              {r.description && <p className="text-[10px] text-gray-400">{r.description}</p>}
                            </div>
                            <span className="text-[11px] text-green-600 font-semibold whitespace-nowrap ml-2">{fmtINR(r.amount)}</span>
                          </div>
                        ))}
                        {unlinked.items.map(i => (
                          <div key={`out-${i.id}`} className="flex justify-between items-start pl-3">
                            <div>
                              <p className="text-[11px] text-red-600 font-medium">↓ {i.name}</p>
                              {i.category && <p className="text-[10px] text-gray-400">{i.category}</p>}
                            </div>
                            <span className="text-[11px] text-red-500 font-semibold whitespace-nowrap ml-2">{fmtINR(i.actual_amount || i.planned_amount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Month net */}
                    <div className="px-4 py-2 bg-gray-50 flex justify-between text-[11px] font-bold">
                      <span className="text-gray-500">Net this month</span>
                      <span className={totalIn - totalOut >= 0 ? 'text-green-600' : 'text-red-500'}>{fmtINR(Math.abs(totalIn - totalOut))} {totalIn - totalOut >= 0 ? 'surplus' : 'deficit'}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {cashFlowMonths.length > 0 && (() => {
            const tp = cashFlowMonths.reduce((s, m) => s + m.planned, 0)
            const ta = cashFlowMonths.reduce((s, m) => s + m.actual, 0)
            return (
              <div className="bg-green-600 border border-green-200/40 rounded-2xl p-4">
                <p className="text-gray-800 text-[10px] font-bold mb-2">PROJECT TOTAL</p>
                <div className="flex justify-between">
                  <div>
                    <p className="text-gray-500 text-[10px]">Total Planned</p>
                    <p className="text-gray-800 font-bold text-base">{fmtINR(tp)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-gray-500 text-[10px]">Total Actual</p>
                    <p className="text-green-600 font-bold text-base">{fmtINR(ta)}</p>
                  </div>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function TasksPage({ onLogout }) {
  const [tasks, setTasks]       = useState([])
  const [summary, setSummary]   = useState({})
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading]   = useState(true)
  const [tab, setTab]           = useState('home')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterCat, setFilterCat] = useState('all')
  const [quickTask, setQuickTask] = useState(null)   // quick action sheet
  const [selectedTask, setSelectedTask] = useState(null) // full detail
  const [showCreate, setShowCreate] = useState(false)
  const [editTask, setEditTask] = useState(null)
  const [confetti, setConfetti] = useState(false)

  const [notifGranted, setNotifGranted] = useState(Notification?.permission==='granted')


  async function requestNotifications() {
    if (!('Notification' in window)) return
    const perm = await Notification.requestPermission()
    setNotifGranted(perm==='granted')
    if (perm==='granted') setupNotifications(tasks)
  }

  const load = useCallback(async () => {
    try {
      const [t,s,c,a] = await Promise.all([getAdminTasks(),getAdminTasksSummary(),getAdminTaskCategories(),getFinanceAccounts()])
      setTasks(t.data); setSummary(s.data); setCategories(c.data); setAccounts(a.data)
      // Setup notifications after load
      if (Notification?.permission==='granted') setupNotifications(t.data)
    } finally { setLoading(false) }
  }, [])

  useEffect(()=>{ load() },[load])

  async function refresh() {
    const [t,s,c,a] = await Promise.all([getAdminTasks(),getAdminTasksSummary(),getAdminTaskCategories(),getFinanceAccounts()])
    setTasks(t.data); setSummary(s.data); setCategories(c.data); setAccounts(a.data)
    if (selectedTask) {
      const updated = t.data.find(x=>x.id===selectedTask.id)
      if (updated) setSelectedTask(updated)
    }
    if (quickTask) {
      const updated = t.data.find(x=>x.id===quickTask.id)
      if (updated) setQuickTask(updated)
    }
  }

  async function handleStatusChange(task, newStatus) {
    if (newStatus==='completed') setConfetti(true)
    await refresh()
  }

  function openQuick(task) { setQuickTask(task) }
  function openFull(task)  { setQuickTask(null); setSelectedTask(task) }

  if (loading) return (
    <div className="min-h-screen bg-[#F2F5F2] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const overdueCount = tasks.filter(t=>!t.parent_id&&isOverdue(t)).length

  // Derive current phase from in-progress tasks (most common category among active tasks)
  const activeCats = tasks.filter(t=>!t.parent_id&&t.status==='in_progress').map(t=>t.category).filter(Boolean)
  const catCount = activeCats.reduce((m,c)=>{m[c]=(m[c]||0)+1;return m},{})
  const currentPhase = Object.keys(catCount).sort((a,b)=>catCount[b]-catCount[a])[0] || null

  const NAV = [
    {key:'home',    icon:'🏠', label:'Home',   badge: overdueCount},
    {key:'tasks',   icon:'📋', label:'Tasks'},
    {key:'budget',  icon:'📒', label:'Budget'},
    {key:'finance', icon:'💰', label:'Finance'},
  ]

  return (
    <div className="min-h-screen bg-[#F2F5F2] flex flex-col relative">
      {confetti&&<Confetti onDone={()=>setConfetti(false)}/>}

      {/* Header */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-gray-900 font-fredoka font-bold text-xl leading-none">🌿 Polyhouse</h1>
            {currentPhase && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 leading-none">{currentPhase}</span>
            )}
          </div>
          <p className="text-gray-400 text-xs mt-0.5">Project Tracker</p>
        </div>
        <div className="flex items-center gap-1.5">
          {tab==='tasks' && (
            <button onClick={()=>setShowCreate(true)} className="bg-green-600 text-white text-xs font-bold px-3 py-2 rounded-xl">
              + New Task
            </button>
          )}
          <button onClick={onLogout} className="flex flex-col items-center text-gray-400 px-2 py-1.5 rounded-xl border border-gray-200">
            <span className="text-sm leading-none">↩</span>
            <span className="text-[9px] mt-0.5 font-medium">Sign out</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab==='home'&&<HomeTab tasks={tasks} summary={summary} accounts={accounts} onTaskClick={openQuick}/>}
        {tab==='budget'&&<BudgetTab/>}
        {tab==='tasks'&&<TasksTab tasks={tasks} categories={categories} onTaskClick={openQuick}
          onStatusChange={handleStatusChange}
          filterStatus={filterStatus} setFilterStatus={setFilterStatus}
          filterCat={filterCat} setFilterCat={setFilterCat}/>}
        {tab==='finance'&&<FinanceTab/>}
      </div>

      {/* Bottom nav */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-gray-200 shadow-lg">
        <div className="flex">
          {NAV.map(n=>(
            <button key={n.key} onClick={()=>setTab(n.key)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 transition-all relative ${tab===n.key?'text-green-600':'text-gray-400'}`}>
              {tab===n.key&&<div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-green-600 rounded-full"/>}
              <div className="relative">
                <span className="text-xl leading-none">{n.icon}</span>
                {n.badge>0&&(
                  <span className="absolute -top-1 -right-2 bg-red-500 text-gray-800 text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
                    {n.badge}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-semibold">{n.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Quick Action Sheet */}
      <BottomSheet show={!!quickTask} onClose={()=>setQuickTask(null)}>
        {quickTask&&<QuickActionSheet
          task={quickTask} allTasks={tasks}
          onClose={()=>setQuickTask(null)}
          onRefresh={refresh}
          onFullDetail={()=>openFull(quickTask)}
          onEdit={()=>{setEditTask(quickTask);setQuickTask(null)}}/>}
      </BottomSheet>

      {/* Task Detail */}
      <BottomSheet show={!!selectedTask} onClose={()=>setSelectedTask(null)}>
        {selectedTask&&<TaskDetail task={selectedTask} allTasks={tasks}
          onEdit={()=>{setEditTask(selectedTask);setSelectedTask(null)}}
          onRefresh={refresh} onClose={()=>setSelectedTask(null)}/>}
      </BottomSheet>

      {/* Create */}
      <BottomSheet show={showCreate} onClose={()=>setShowCreate(false)} title="New Task">
        <TaskForm task={null} categories={categories} allTasks={tasks} onSave={refresh} onClose={()=>setShowCreate(false)}/>
      </BottomSheet>

      {/* Edit */}
      <BottomSheet show={!!editTask} onClose={()=>setEditTask(null)} title="Edit Task">
        {editTask&&<TaskForm task={editTask} categories={categories} allTasks={tasks} onSave={refresh} onClose={()=>setEditTask(null)}/>}
      </BottomSheet>
    </div>
  )
}




