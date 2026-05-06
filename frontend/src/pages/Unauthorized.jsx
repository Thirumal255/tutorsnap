import { Link } from 'react-router-dom'

export default function Unauthorized() {
  return (
    <div className="min-h-screen bg-green-50 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-700 mb-2">Access Denied</h1>
        <p className="text-gray-500 mb-6">You don't have access to this page.</p>
        <Link to="/" className="text-green-600 hover:underline text-sm">← Back to home</Link>
      </div>
    </div>
  )
}
