const LABELS = {
  L1: 'Getting started',
  L2: 'Building up',
  L3: 'Practising',
  L4: 'Going deeper',
  L5: 'Challenge mode',
}

const COLORS = {
  L1: 'bg-gray-100 text-gray-700',
  L2: 'bg-blue-100 text-blue-700',
  L3: 'bg-green-100 text-green-700',
  L4: 'bg-purple-100 text-purple-700',
  L5: 'bg-orange-100 text-orange-700',
}

export default function ProgressBadge({ level }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${COLORS[level] || 'bg-gray-100 text-gray-700'}`}>
      {level} · {LABELS[level] || level}
    </span>
  )
}
