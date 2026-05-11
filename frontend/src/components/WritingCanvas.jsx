import { useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react'

/**
 * WritingCanvas — a pressure-sensitive HTML5 canvas for handwritten answers.
 *
 * Ref API (useImperativeHandle):
 *   - getImageData()  → base64 JPEG string (no "data:..." prefix) or null if blank
 *   - clear()         → wipe the canvas
 *   - undo()          → step back one stroke
 *   - isEmpty()       → true if no strokes drawn yet
 */
const WritingCanvas = forwardRef(function WritingCanvas({ className = '' }, ref) {
  const canvasRef = useRef(null)
  const isDrawing = useRef(false)
  const lastPoint = useRef(null)
  const undoStack = useRef([])   // snapshots (dataURL) before each stroke
  const hasStrokes = useRef(false)

  // Scale canvas for HiDPI screens
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width  = rect.width  * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#1A1A3E'
    ctx.fillRect(0, 0, rect.width, rect.height)
  }, [])

  const getPos = useCallback((e, canvas) => {
    const rect = canvas.getBoundingClientRect()
    if (e.touches) {
      const t = e.touches[0]
      return { x: t.clientX - rect.left, y: t.clientY - rect.top, pressure: t.force || 0.5 }
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure: e.pressure || 0.5 }
  }, [])

  const saveSnapshot = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    undoStack.current.push(canvas.toDataURL())
    // Keep stack bounded
    if (undoStack.current.length > 30) undoStack.current.shift()
  }, [])

  const startDraw = useCallback((e) => {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    saveSnapshot()
    isDrawing.current = true
    lastPoint.current = getPos(e, canvas)
  }, [getPos, saveSnapshot])

  const draw = useCallback((e) => {
    e.preventDefault()
    if (!isDrawing.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const pos = getPos(e, canvas)
    const pressure = pos.pressure || 0.5
    const lineWidth = Math.max(1.5, pressure * 5)

    ctx.beginPath()
    ctx.lineWidth   = lineWidth
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.strokeStyle = '#E2E8FF'
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(pos.x, pos.y)
    ctx.stroke()

    lastPoint.current = pos
    hasStrokes.current = true
  }, [getPos])

  const stopDraw = useCallback((e) => {
    e?.preventDefault()
    isDrawing.current = false
    lastPoint.current = null
  }, [])

  // Expose ref API
  useImperativeHandle(ref, () => ({
    getImageData() {
      if (!hasStrokes.current) return null
      const canvas = canvasRef.current
      if (!canvas) return null
      // Export as JPEG (strips alpha, keeps file small for API)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
      return dataUrl.split(',')[1]
    },
    clear() {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      ctx.fillStyle = '#1A1A3E'
      ctx.fillRect(0, 0, rect.width, rect.height)
      undoStack.current = []
      hasStrokes.current = false
    },
    undo() {
      const canvas = canvasRef.current
      if (!canvas || undoStack.current.length === 0) return
      const snap = undoStack.current.pop()
      const img = new Image()
      img.onload = () => {
        const ctx = canvas.getContext('2d')
        const dpr = window.devicePixelRatio || 1
        const rect = canvas.getBoundingClientRect()
        ctx.clearRect(0, 0, rect.width, rect.height)
        ctx.drawImage(img, 0, 0, rect.width, rect.height)
        if (undoStack.current.length === 0) hasStrokes.current = false
      }
      img.src = snap
    },
    isEmpty() {
      return !hasStrokes.current
    },
  }), [])

  return (
    <canvas
      ref={canvasRef}
      className={`touch-none rounded-2xl border border-[#2D2B5A] cursor-crosshair ${className}`}
      style={{ display: 'block', width: '100%', height: '180px', background: '#1A1A3E' }}
      onPointerDown={startDraw}
      onPointerMove={draw}
      onPointerUp={stopDraw}
      onPointerLeave={stopDraw}
      onPointerCancel={stopDraw}
      onTouchStart={startDraw}
      onTouchMove={draw}
      onTouchEnd={stopDraw}
    />
  )
})

export default WritingCanvas
