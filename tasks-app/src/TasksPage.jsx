import { useState, useEffect, useCallback, useRef } from 'react'
import {
  getAdminTasks, getAdminTasksSummary, getAdminTaskCategories,
  createAdminTask, updateAdminTask, deleteAdminTask,
  addTaskExpense, updateTaskExpense, deleteTaskExpense,
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
        <p className="text-white font-bold text-sm mb-3">Change Status</p>
        <p className="text-[#8892B0] text-xs mb-4 truncate">{task.title}</p>
        <div className="space-y-2">
          {Object.entries(S).map(([key,meta])=>(
            <button key={key} onClick={()=>onSelect(key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                task.status===key?`${meta.bg} border-2 border-current`:`hover:${meta.bg} border border-transparent`
              }`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${meta.dot}`}/>
              <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
              {task.status===key&&<span className="ml-auto text-xs text-[#8892B0]">current</span>}
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

function SubtaskPill({ subtasks }) {
  if (!subtasks?.length) return null
  const done = subtasks.filter(s=>s.status==='completed').length
  const total = subtasks.length
  const pct = Math.round((done/total)*100)
  const all_done = done===total
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${all_done?'bg-[#00CC88]/15 text-[#00CC88]':'bg-[#2D2B5A]/50 text-[#8892B0]'}`}>
      <span>{all_done?'✓':done+'/'+total}</span>
      <span>{total===1?'subtask':'subtasks'}</span>
      {!all_done&&(
        <div className="w-10 h-1 bg-[#0F0F23] rounded-full overflow-hidden">
          <div className="h-full bg-[#00A2FF] rounded-full" style={{width:`${pct}%`}}/>
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, onClick, onStatusChange }) {
  const overdue = isOverdue(task)
  const days = daysLeft(task.end_date)
  const spent = task.total_expense||0
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
      <div {...longPress} onClick={()=>onClick(task)}
        className={`bg-[#16213E] border border-[#2D2B5A] border-l-4 ${PRI_BORDER[task.priority]||'border-l-[#8892B0]'} rounded-2xl p-4 cursor-pointer active:scale-[0.99] transition-all hover:border-[#00A2FF]/40 space-y-2.5 select-none`}>

        {/* Top row: complete btn + title + status */}
        <div className="flex items-start gap-2.5">
          {/* One-tap complete button */}
          <button onClick={handleComplete} disabled={completing}
            className={`w-6 h-6 rounded-full border-2 flex-shrink-0 flex items-center justify-center mt-0.5 transition-all ${
              isDone ? 'bg-[#00CC88] border-[#00CC88] text-white'
                     : 'border-[#2D2B5A] text-transparent hover:border-[#00CC88] hover:text-[#00CC88]'
            }`}>
            <span className="text-xs font-bold leading-none">✓</span>
          </button>

          <div className="flex-1 min-w-0">
            <h3 className={`font-semibold text-sm leading-snug ${isDone?'line-through text-[#8892B0]':'text-white'}`}>
              {task.title}
            </h3>
            {/* Notes preview */}
            {task.notes&&!isDone&&(
              <p className="text-[#8892B0] text-xs mt-0.5 truncate">{task.notes}</p>
            )}
          </div>
          <StatusBadge status={task.status}/>
        </div>

        {/* Budget bar */}
        {task.budget>0 && <BudgetBar budget={task.budget} spent={spent} compact/>}

        {/* Bottom row: dates + subtask pill */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {(task.start_date||task.end_date)&&(
              <span className={`flex items-center gap-1 ${overdue?'text-[#FF3333] font-semibold':days!=null&&days<=2?'text-[#FFB347]':'text-[#8892B0]'}`}>
                {overdue?'⚠️':'📅'}
                {task.start_date&&<span>{fmtShort(task.start_date)}</span>}
                {task.start_date&&task.end_date&&<span className="text-[#2D2B5A]">→</span>}
                {task.end_date&&<span>{fmtShort(task.end_date)}</span>}
                {overdue?` (${Math.abs(days)}d late)`:days!=null&&days<=3?` (${days}d)`:''}
              </span>
            )}
          </div>
          <SubtaskPill subtasks={task.subtasks}/>
        </div>
      </div>
      {showPicker&&<StatusPicker task={task} onSelect={handleStatusSelect} onClose={()=>setShowPicker(false)}/>}
    </>
  )
}

// ── Task Form ──────────────────────────────────────────────────────────────────

function TaskForm({ task, categories, allTasks=[], onSave, onClose }) {
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

      {/* Dependencies */}
      {eligibleDeps.length>0&&(
        <div>
          <label className={lbl}>🔗 Depends On <span className="font-normal">(same category)</span></label>
          <div className="space-y-2 max-h-48 overflow-y-auto bg-[#0F0F23] rounded-xl p-3 border border-[#2D2B5A]">
            {eligibleDeps.map(t=>{
              const checked = form.dependency_ids.includes(t.id)
              return (
                <div key={t.id} onClick={()=>toggleDep(t.id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                    checked?'bg-[#00A2FF]/15 border border-[#00A2FF]/30':'hover:bg-[#16213E] border border-transparent'
                  }`}>
                  <div className={`w-4 h-4 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${
                    checked?'bg-[#00A2FF] border-[#00A2FF]':'border-[#2D2B5A]'
                  }`}>
                    {checked&&<span className="text-white text-xs leading-none">✓</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold truncate">{t.title}</p>
                    <p className={`text-xs ${S[t.status]?.color||'text-[#8892B0]'}`}>{S[t.status]?.label}</p>
                  </div>
                </div>
              )
            })}
          </div>
          {form.dependency_ids.length>0&&(
            <p className="text-[#00A2FF] text-xs mt-1">{form.dependency_ids.length} dependenc{form.dependency_ids.length>1?'ies':'y'} selected</p>
          )}
        </div>
      )}

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
  const [form, setForm] = useState({ amount:'', description:'', expense_date: new Date().toISOString().split('T')[0], status:'planned' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  async function handleSave() {
    const amount = parseFloat(form.amount)
    if (isNaN(amount)||amount<=0) return setError('Enter a valid amount')
    setSaving(true); setError('')
    try {
      await addTaskExpense(task.id,{amount,description:form.description||null,expense_date:form.expense_date,status:form.status})
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
      {/* Status toggle */}
      <div className="flex gap-2">
        {[{key:'planned',label:'🕐 Planned',color:'border-[#FFB347] bg-[#FFB347]/10 text-[#FFB347]'},
          {key:'paid',   label:'✅ Paid',   color:'border-[#00CC88] bg-[#00CC88]/10 text-[#00CC88]'}].map(s=>(
          <button key={s.key} onClick={()=>set('status',s.key)}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold border-2 transition-all ${form.status===s.key?s.color:'border-[#2D2B5A] text-[#8892B0]'}`}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className={lbl}>Amount (₹) *</label><input type="number" value={form.amount} onChange={e=>set('amount',e.target.value)} className={inp} placeholder="0.00" min="0" autoFocus/></div>
        <div><label className={lbl}>Date</label><input type="date" value={form.expense_date} onChange={e=>set('expense_date',e.target.value)} className={inp}/></div>
      </div>
      <div><label className={lbl}>Description</label><input value={form.description} onChange={e=>set('description',e.target.value)} className={inp} placeholder="What was this for?"/></div>
      {error&&<p className="text-[#FF3333] text-xs">{error}</p>}
      <button onClick={handleSave} disabled={saving}
        className={`w-full text-white font-bold py-3.5 rounded-2xl text-sm disabled:opacity-50 ${form.status==='paid'?'bg-[#00CC88]':'bg-[#FFB347]'}`}>
        {saving?'Adding…':`Add as ${form.status==='paid'?'Paid':'Planned'}`}
      </button>
    </div>
  )
}

// ── Set Budget Form ────────────────────────────────────────────────────────────

function SetBudgetForm({ task, allTasks, onSave, onClose }) {
  const inp = "w-full bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF] placeholder-[#8892B0]"
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

// ── Quick Action Sheet ─────────────────────────────────────────────────────────

function QuickActionSheet({ task, allTasks, onClose, onRefresh, onFullDetail }) {
  const [action, setAction] = useState(null) // 'status'|'expense'|'budget'|'deps'|'subtasks'
  const overdue = isOverdue(task)
  const spent = task.total_expense || 0
  const subtasks = task.subtasks || []

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
        <p className="text-white font-bold text-sm">Change Status</p>
        <button onClick={()=>setAction(null)} className="text-[#8892B0] text-xl">×</button>
      </div>
      <p className="text-[#8892B0] text-xs truncate mb-3">{task.title}</p>
      {Object.entries(S).map(([key,meta])=>(
        <button key={key} onClick={()=>handleStatusSelect(key)}
          className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl transition-all border ${
            task.status===key?`${meta.bg} border-current`:`hover:${meta.bg} border-[#2D2B5A]`
          }`}>
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${meta.dot}`}/>
          <span className={`text-sm font-semibold ${meta.color}`}>{meta.label}</span>
          {task.status===key&&<span className="ml-auto text-xs text-[#8892B0]">current</span>}
        </button>
      ))}
    </div>
  )

  if (action === 'expense') return (
    <AddExpenseForm task={task} onSave={async()=>{await onRefresh();setAction(null)}} onClose={()=>setAction(null)}/>
  )

  if (action === 'budget') return (
    <SetBudgetForm task={task} allTasks={allTasks} onSave={async()=>{await onRefresh();setAction(null)}} onClose={()=>setAction(null)}/>
  )

  if (action === 'deps') {
    const activeCat = task.category
    const eligible = allTasks.filter(t=>t.category===activeCat && t.id!==task.id && !t.parent_id)
    const [sel, setSel] = useState(task.dependency_ids||[])
    const toggle = (id) => setSel(s=>s.includes(id)?s.filter(x=>x!==id):[...s,id])
    return (
      <div className="p-5 space-y-3">
        <div className="flex items-center justify-between mb-1">
          <p className="text-white font-bold text-sm">🔗 Link Dependencies</p>
          <button onClick={()=>setAction(null)} className="text-[#8892B0] text-xl">×</button>
        </div>
        <p className="text-[#8892B0] text-xs mb-2">{task.category} tasks</p>
        {eligible.length===0
          ? <p className="text-[#8892B0] text-xs italic py-4 text-center">No other tasks in this category</p>
          : <div className="space-y-2 max-h-56 overflow-y-auto">
              {eligible.map(t=>{
                const checked = sel.includes(t.id)
                return (
                  <div key={t.id} onClick={()=>toggle(t.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all border ${
                      checked?'bg-[#00A2FF]/15 border-[#00A2FF]/30':'bg-[#0F0F23] border-transparent hover:border-[#2D2B5A]'
                    }`}>
                    <div className={`w-4 h-4 rounded-md border-2 flex-shrink-0 flex items-center justify-center ${checked?'bg-[#00A2FF] border-[#00A2FF]':'border-[#2D2B5A]'}`}>
                      {checked&&<span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-semibold truncate">{t.title}</p>
                      <p className={`text-xs ${S[t.status]?.color}`}>{S[t.status]?.label}</p>
                    </div>
                  </div>
                )
              })}
            </div>
        }
        <button onClick={()=>saveDeps(sel)}
          className="w-full bg-[#00A2FF] text-white font-bold py-3 rounded-2xl text-sm">
          Save Dependencies
        </button>
      </div>
    )
  }

  if (action === 'subtasks') return (
    <div className="p-5 space-y-3">
      <div className="flex items-center justify-between mb-1">
        <p className="text-white font-bold text-sm">📋 Sub-tasks</p>
        <button onClick={()=>setAction(null)} className="text-[#8892B0] text-xl">×</button>
      </div>
      <p className="text-[#8892B0] text-xs truncate mb-2">{task.title}</p>
      <SubtasksSection task={task} subtasks={subtasks} onRefresh={async()=>{ await onRefresh() }}/>
    </div>
  )

  // Default: quick actions menu
  return (
    <div className="p-5 space-y-4">
      {/* Task header */}
      <div className={`border-l-4 ${PRI_BORDER[task.priority]||'border-l-[#8892B0]'} pl-3 space-y-1`}>
        <p className="text-white font-bold text-sm leading-snug">{task.title}</p>
        <div className="flex items-center gap-2">
          <p className="text-[#8892B0] text-xs">{task.category}</p>
          <StatusBadge status={task.status}/>
          {overdue&&<span className="text-[#FF3333] text-xs font-bold">⚠️ Overdue</span>}
        </div>
        {task.budget>0&&<BudgetBar budget={task.budget} spent={spent} compact/>}
      </div>

      {/* Quick action buttons — 3 columns */}
      <div className="grid grid-cols-3 gap-2">
        {[
          {key:'status',   icon:'⚡', label:'Status',      color:'text-[#00A2FF]', bg:'bg-[#00A2FF]/10 border-[#00A2FF]/20'},
          {key:'expense',  icon:'💸', label:'Add Expense', color:'text-[#00CC88]', bg:'bg-[#00CC88]/10 border-[#00CC88]/20'},
          {key:'budget',   icon:'🎯', label:'Budget',      color:'text-[#FFB347]', bg:'bg-[#FFB347]/10 border-[#FFB347]/20'},
          {key:'subtasks', icon:'📋', label:`Sub-tasks${subtasks.length>0?` (${subtasks.length})`:''}`, color:'text-[#00A2FF]', bg:'bg-[#00A2FF]/10 border-[#00A2FF]/20'},
          {key:'deps',     icon:'🔗', label:'Dependencies', color:'text-[#A78BFA]', bg:'bg-[#A78BFA]/10 border-[#A78BFA]/20'},
        ].map(btn=>(
          <button key={btn.key} onClick={()=>setAction(btn.key)}
            className={`flex flex-col items-center gap-1.5 border rounded-2xl p-3 active:scale-95 transition-all ${btn.bg}`}>
            <span className="text-xl">{btn.icon}</span>
            <p className={`text-xs font-bold text-center leading-tight ${btn.color}`}>{btn.label}</p>
          </button>
        ))}
      </div>

      <button onClick={onFullDetail}
        className="w-full flex items-center justify-between px-4 py-2.5 text-[#8892B0] hover:text-white transition-colors">
        <span className="text-sm">View full details</span>
        <span>→</span>
      </button>
    </div>
  )
}

// ── Task Detail ────────────────────────────────────────────────────────────────

function SubtasksSection({ task, subtasks, onRefresh }) {
  const [input, setInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const inp = "flex-1 bg-[#0F0F23] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#00A2FF] placeholder-[#8892B0]"

  async function addSubtask() {
    const title = input.trim()
    if (!title) return
    setSaving(true)
    try {
      await createAdminTask({ title, category: task.category, status:'not_started', priority:'medium', parent_id: task.id })
      setInput(''); await onRefresh()
    } catch(e) { alert(e.response?.data?.detail||'Failed') }
    finally { setSaving(false) }
  }

  async function toggleStatus(st) {
    const next = st.status==='completed' ? 'not_started' : 'completed'
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
        <p className="text-[#8892B0] text-xs font-semibold">
          Sub-tasks {subtasks.length>0&&`(${done}/${subtasks.length} done)`}
        </p>
        <button onClick={()=>setAdding(a=>!a)}
          className="text-[#00A2FF] text-xs font-semibold">
          {adding?'Cancel':'+ Add'}
        </button>
      </div>

      {subtasks.length>0&&(
        <div className="space-y-1.5 mb-2">
          {subtasks.map(st=>(
            <div key={st.id} className="flex items-center gap-2 bg-[#0F0F23] rounded-xl px-3 py-2">
              <button onClick={()=>toggleStatus(st)}
                className={`w-4 h-4 rounded-md border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                  st.status==='completed'?'bg-[#00CC88] border-[#00CC88]':'border-[#2D2B5A]'
                }`}>
                {st.status==='completed'&&<span className="text-white text-xs leading-none">✓</span>}
              </button>
              <span className={`text-xs flex-1 ${st.status==='completed'?'text-[#8892B0] line-through':'text-white'}`}>
                {st.title}
              </span>
              <button onClick={()=>deleteSubtask(st)} className="text-[#8892B0] hover:text-[#FF3333] text-base leading-none">×</button>
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
            className="bg-[#00A2FF] text-white text-xs font-bold px-3 py-2 rounded-xl disabled:opacity-40">
            {saving?'…':'Add'}
          </button>
        </div>
      )}

      {subtasks.length===0&&!adding&&(
        <p className="text-[#8892B0] text-xs italic">No sub-tasks yet</p>
      )}
    </div>
  )
}

function TaskDetail({ task, allTasks, onEdit, onRefresh, onClose }) {
  const [showExp, setShowExp] = useState(false)
  const [showBudget, setShowBudget] = useState(false)
  const [deleting, setDeleting] = useState(false)
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

        {/* Sub-tasks */}
        <SubtasksSection task={task} subtasks={subtasks} onRefresh={onRefresh}/>

        {/* Dependencies */}
        {task.dependency_ids?.length>0&&(()=>{
          const deps = task.dependency_ids.map(id=>allTasks.find(t=>t.id===id)).filter(Boolean)
          return deps.length>0 ? (
            <div>
              <p className="text-[#8892B0] text-xs font-semibold mb-2">🔗 Depends On ({deps.length})</p>
              <div className="space-y-2">
                {deps.map(dep=>(
                  <div key={dep.id} className="flex items-center gap-3 bg-[#0F0F23] rounded-xl px-3 py-2.5">
                    <StatusBadge status={dep.status}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-semibold truncate">{dep.title}</p>
                      <p className="text-[#8892B0] text-xs">{dep.category}</p>
                    </div>
                    {dep.status!=='completed'&&<span className="text-[#FFB347] text-xs">⚠️ Pending</span>}
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
              <div className="bg-[#0F0F23] rounded-2xl p-3 mb-3 grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[#8892B0] text-xs">Allocated</p>
                  <p className="text-white font-bold text-sm">{fmtINR(paid+planned)}</p>
                </div>
                <div>
                  <p className="text-[#8892B0] text-xs">Paid</p>
                  <p className="text-[#00CC88] font-bold text-sm">{fmtINR(paid)}</p>
                </div>
                <div>
                  <p className="text-[#8892B0] text-xs">Planned</p>
                  <p className="text-[#FFB347] font-bold text-sm">{fmtINR(planned)}</p>
                </div>
              </div>
            )
          })()}

          <p className="text-[#8892B0] text-xs font-semibold mb-2">Expenses</p>
          {task.expenses?.length>0 ? (
            <div className="space-y-2">
              {task.expenses.map(e=>(
                <div key={e.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${
                  e.status==='paid'?'bg-[#00CC88]/5 border-[#00CC88]/20':'bg-[#FFB347]/5 border-[#FFB347]/20'
                }`}>
                  {/* Toggle paid/planned */}
                  <button onClick={async()=>{ await updateTaskExpense(task.id,e.id,{status:e.status==='paid'?'planned':'paid'}); await onRefresh() }}
                    className={`flex-shrink-0 text-xs font-bold px-2 py-1 rounded-lg transition-all ${
                      e.status==='paid'?'bg-[#00CC88]/20 text-[#00CC88]':'bg-[#FFB347]/20 text-[#FFB347]'
                    }`}>
                    {e.status==='paid'?'✅ Paid':'🕐 Planned'}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold">{fmtINR(e.amount)}</p>
                    <p className="text-[#8892B0] text-xs truncate">{e.description||'—'} · {fmtShort(e.expense_date)}</p>
                  </div>
                  <button onClick={()=>handleDeleteExp(e.id)} className="text-[#8892B0] hover:text-[#FF3333] text-xl leading-none flex-shrink-0">×</button>
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
  const ongoingByCategory = {}
  ongoing.forEach(t=>{
    if (!ongoingByCategory[t.category]) ongoingByCategory[t.category]=[]
    ongoingByCategory[t.category].push(t)
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
            {Object.entries(ongoingByCategory).sort().map(([cat,catTasks])=>{
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
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-semibold text-sm leading-snug">{t.title}</p>
                              {t.notes&&<p className="text-[#8892B0] text-xs mt-0.5 truncate">{t.notes}</p>}
                            </div>
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
                          <SubtaskPill subtasks={t.subtasks}/>
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

  const STATUS_COLOR = { completed:'bg-[#00CC88]', in_progress:'bg-[#00A2FF]', on_hold:'bg-[#FFB347]', not_started:'bg-[#8892B0]' }

  return (
    <div className="pb-6">
      {/* Month nav */}
      <div className="flex items-center justify-between px-4 py-3">
        <button onClick={()=>{setCur(new Date(yr,mo-1,1));setSelDay(null)}}
          className="w-9 h-9 flex items-center justify-center bg-[#16213E] rounded-xl text-white text-lg">‹</button>
        <p className="text-white font-bold text-sm">{monthLabel}</p>
        <button onClick={()=>{setCur(new Date(yr,mo+1,1));setSelDay(null)}}
          className="w-9 h-9 flex items-center justify-center bg-[#16213E] rounded-xl text-white text-lg">›</button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 px-4 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d=>(
          <p key={d} className="text-[#8892B0] text-xs text-center font-semibold py-1">{d}</p>
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
                sel?'bg-[#00A2FF]/20 border border-[#00A2FF]/50':
                isToday?'bg-[#00A2FF]/10 border border-[#00A2FF]/30':
                'hover:bg-[#16213E] border border-transparent'
              }`}>
              <p className={`text-xs font-bold leading-none pt-0.5 ${isToday?'text-[#00A2FF]':sel?'text-white':'text-[#8892B0]'}`}>{day}</p>
              {dayTasks.length>0&&(
                <div className="flex flex-wrap gap-0.5 justify-center">
                  {dayTasks.slice(0,4).map(t=>(
                    <div key={t.id} className={`w-1.5 h-1.5 rounded-full ${isOverdue(t)?'bg-[#FF3333]':STATUS_COLOR[t.status]||'bg-[#8892B0]'}`}/>
                  ))}
                  {dayTasks.length>4&&<div className="w-1.5 h-1.5 rounded-full bg-[#FFB347]"/>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 px-4 mt-3 flex-wrap">
        {[['bg-[#00A2FF]','In Progress'],['bg-[#00CC88]','Completed'],['bg-[#FFB347]','On Hold'],['bg-[#FF3333]','Overdue'],['bg-[#8892B0]','Not Started']].map(([c,l])=>(
          <div key={l} className="flex items-center gap-1"><div className={`w-2 h-2 rounded-full ${c}`}/><p className="text-[#8892B0] text-xs">{l}</p></div>
        ))}
      </div>

      {/* Selected day task list */}
      {selDay&&(
        <div className="px-4 mt-4 space-y-2">
          <p className="text-[#8892B0] text-xs font-semibold">{selTasks.length} task{selTasks.length!==1?'s':''} due {selDay} {monthLabel}</p>
          {selTasks.length===0
            ? <p className="text-[#8892B0] text-xs italic">No tasks due this day</p>
            : selTasks.map(t=>(
              <div key={t.id} onClick={()=>onTaskClick(t)}
                className={`border-l-4 ${PRI_BORDER[t.priority]||'border-l-[#8892B0]'} bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2.5 cursor-pointer flex items-center gap-3`}>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{t.title}</p>
                  <p className="text-[#8892B0] text-xs">{t.category}</p>
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

  // Build events: each task contributes a start event and/or end event
  const events = [] // {date, type:'start'|'end'|'due', task}
  root.forEach(t=>{
    if (t.start_date) events.push({dateStr:t.start_date, type:'start', task:t})
    if (t.end_date && t.end_date!==t.start_date) events.push({dateStr:t.end_date, type:'due', task:t})
    else if (t.end_date && !t.start_date) events.push({dateStr:t.end_date, type:'due', task:t})
  })
  events.sort((a,b)=>a.dateStr.localeCompare(b.dateStr))

  if (events.length===0) return (
    <div className="flex items-center justify-center py-20 text-[#8892B0] text-sm">No tasks with dates</div>
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
    start:{ icon:'🚀', label:'Starts', color:'text-[#00A2FF]', dot:'bg-[#00A2FF]' },
    due:  { icon:'🏁', label:'Due',    color:'text-[#FFB347]', dot:'bg-[#FFB347]' },
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
                isToday?'bg-[#00A2FF] border-[#00A2FF]':
                isPast?'bg-[#2D2B5A] border-[#2D2B5A]':'bg-[#0F0F23] border-[#8892B0]'
              }`}/>
              {gi<Object.keys(grouped).length-1&&<div className="w-0.5 flex-1 bg-[#2D2B5A] mt-1"/>}
            </div>

            {/* Content */}
            <div className="flex-1 pb-5 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <p className={`text-xs font-bold ${isToday?'text-[#00A2FF]':isPast?'text-[#8892B0]':'text-white'}`}>
                  {isToday?'Today · ':''}{dayLabel}
                </p>
                {isToday&&<span className="bg-[#00A2FF] text-white text-xs px-1.5 py-0.5 rounded-full font-bold">TODAY</span>}
              </div>
              <div className="space-y-2">
                {evs.map((ev,ei)=>{
                  const ts = TYPE_STYLE[ev.type]||TYPE_STYLE.due
                  const over = ev.type==='due'&&isOverdue(ev.task)
                  return (
                    <div key={`${ev.task.id}-${ev.type}-${ei}`} onClick={()=>onTaskClick(ev.task)}
                      className={`border-l-4 ${PRI_BORDER[ev.task.priority]||'border-l-[#8892B0]'} rounded-xl p-3 cursor-pointer active:scale-[0.99] transition-all ${
                        over?'bg-[#FF3333]/8 border border-[#FF3333]/20':'bg-[#16213E] border border-[#2D2B5A]'
                      }`}>
                      <div className="flex items-start gap-2">
                        <span className="text-sm flex-shrink-0">{over?'⚠️':ts.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-white text-xs font-semibold">{ev.task.title}</p>
                            <span className={`text-xs font-semibold ${over?'text-[#FF3333]':ts.color}`}>
                              · {over?'OVERDUE':ts.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-[#8892B0] text-xs">{ev.task.category}</p>
                            <StatusBadge status={ev.task.status}/>
                          </div>
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
  const root = tasks.filter(t=>!t.parent_id)
  const q = search.trim().toLowerCase()
  const filtered = root
    .filter(t=>filterStatus==='all'||t.status===filterStatus)
    .filter(t=>filterCat==='all'||t.category===filterCat)
    .filter(t=>!q || t.title.toLowerCase().includes(q) || t.category.toLowerCase().includes(q) || (t.notes||'').toLowerCase().includes(q))

  const VIEWS = [
    {key:'list',     icon:'☰',  label:'List'},
    {key:'calendar', icon:'📅', label:'Calendar'},
    {key:'timeline', icon:'🕐', label:'Timeline'},
  ]

  return (
    <div className="pb-28">
      {/* Search bar */}
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8892B0] text-sm">🔍</span>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            className="w-full bg-[#16213E] border border-[#2D2B5A] rounded-xl pl-9 pr-9 py-2.5 text-white text-sm focus:outline-none focus:border-[#00A2FF] placeholder-[#8892B0]"
            placeholder="Search tasks…"/>
          {search&&(
            <button onClick={()=>setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8892B0] hover:text-white text-lg leading-none">×</button>
          )}
        </div>
      </div>

      {/* View switcher */}
      <div className="px-4 pb-3 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
        {VIEWS.map(v=>(
          <button key={v.key} onClick={()=>setView(v.key)}
            className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
              view===v.key?'bg-[#00A2FF] text-white border-[#00A2FF]':'bg-[#16213E] text-[#8892B0] border-[#2D2B5A]'
            }`}>
            <span>{v.icon}</span>{v.label}
          </button>
        ))}
      </div>

      {/* Filters — all views */}
      {!q&&(
        <>
          <div className="px-4 pb-2 flex gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>
            {[{key:'all',label:'All'},{key:'in_progress',label:'In Progress'},{key:'not_started',label:'Not Started'},
              {key:'on_hold',label:'On Hold'},{key:'completed',label:'Completed'}].map(f=>(
              <button key={f.key} onClick={()=>setFilterStatus(f.key)}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                  filterStatus===f.key?'bg-[#00A2FF] text-white':'bg-[#16213E] text-[#8892B0] border border-[#2D2B5A]'
                }`}>{f.label}</button>
            ))}
          </div>
          <div className="px-4 pb-3">
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)}
              className="w-full bg-[#16213E] border border-[#2D2B5A] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-[#00A2FF]">
              <option value="all">All Categories</option>
              {categories.map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </>
      )}

      {/* Task count */}
      <div className="px-4 pb-2">
        <p className="text-[#8892B0] text-xs">
          {q ? `${filtered.length} result${filtered.length!==1?'s':''} for "${search}"` : `${filtered.length} task${filtered.length!==1?'s':''}`}
        </p>
      </div>

      {/* Views — all receive filtered tasks */}
      {view==='list'&&(
        <div className="px-4 space-y-3">
          {filtered.length===0
            ? <div className="text-center py-16"><p className="text-4xl mb-3">{q?'🔍':'✅'}</p><p className="text-[#8892B0] text-sm">{q?'No tasks match your search':'No tasks match this filter'}</p></div>
            : filtered.map(t=><TaskCard key={t.id} task={t} onClick={onTaskClick} onStatusChange={onStatusChange}/>)}
        </div>
      )}

      {view==='calendar' && <CalendarView tasks={filtered} onTaskClick={onTaskClick}/>}
      {view==='timeline' && <TimelineView tasks={filtered} onTaskClick={onTaskClick}/>}
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
      const [t,s,c] = await Promise.all([getAdminTasks(),getAdminTasksSummary(),getAdminTaskCategories()])
      setTasks(t.data); setSummary(s.data); setCategories(c.data)
      // Setup notifications after load
      if (Notification?.permission==='granted') setupNotifications(t.data)
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
    <div className="min-h-screen bg-[#0F0F23] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#00A2FF] border-t-transparent rounded-full animate-spin"/>
    </div>
  )

  const overdueCount = tasks.filter(t=>!t.parent_id&&isOverdue(t)).length

  const NAV = [
    {key:'home',    icon:'🏠', label:'Home', badge: overdueCount},
    {key:'tasks',   icon:'📋', label:'Tasks'},
    {key:'expenses',icon:'💰', label:'Expenses'},
  ]

  return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col max-w-2xl mx-auto relative">
      {confetti&&<Confetti onDone={()=>setConfetti(false)}/>}

      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#0F0F23]/95 backdrop-blur-md border-b border-[#2D2B5A] px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-white font-fredoka font-bold text-xl leading-none">My Tasks</h1>
          <p className="text-[#8892B0] text-xs mt-0.5">Personal task tracker</p>
        </div>
        <div className="flex items-center gap-1.5">
          {(tab==='tasks'||tab==='home')&&(
            <button onClick={()=>setShowCreate(true)} className="bg-[#00A2FF] text-white text-xs font-bold px-3 py-2 rounded-xl">
              + New
            </button>
          )}
          {/* Notification bell */}
          <button onClick={requestNotifications} title={notifGranted?'Notifications on':'Enable notifications'}
            className={`w-8 h-8 flex items-center justify-center rounded-xl border border-[#2D2B5A] text-sm ${notifGranted?'text-[#00CC88]':'text-[#8892B0]'}`}>
            {notifGranted?'🔔':'🔕'}
          </button>

          <button onClick={onLogout} className="text-[#8892B0] text-xs px-2 py-2 rounded-xl border border-[#2D2B5A]">
            ↩
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab==='home'&&<HomeTab tasks={tasks} onTaskClick={openQuick}/>}
        {tab==='tasks'&&<TasksTab tasks={tasks} categories={categories} onTaskClick={openQuick}
          onStatusChange={handleStatusChange}
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
              <div className="relative">
                <span className="text-xl leading-none">{n.icon}</span>
                {n.badge>0&&(
                  <span className="absolute -top-1 -right-2 bg-[#FF3333] text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center px-0.5">
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
          onFullDetail={()=>openFull(quickTask)}/>}
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
