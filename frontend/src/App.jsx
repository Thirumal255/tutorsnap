import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { UploadProvider } from './context/UploadContext'
import Login from './pages/Login'
import Unauthorized from './pages/Unauthorized'
import TopicSelect from './pages/TopicSelect'
import Chat from './pages/Chat'
import Summary from './pages/Summary'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminStudents from './pages/admin/AdminStudents'
import AdminStudentDetail from './pages/admin/AdminStudentDetail'
import AdminParents from './pages/admin/AdminParents'
import AdminFlagged from './pages/admin/AdminFlagged'
import AdminSettings from './pages/admin/AdminSettings'
import AdminBooks from './pages/admin/AdminBooks'
import ParentLayout from './pages/parent/ParentLayout'
import ParentDashboard from './pages/parent/ParentDashboard'
import ParentChildDetail from './pages/parent/ParentChildDetail'
import ParentNotifications from './pages/parent/ParentNotifications'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID} onScriptLoadError={() => console.error('GSI script failed')}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* Student */}
            <Route path="/" element={
              <ProtectedRoute roles={['student']}>
                <TopicSelect />
              </ProtectedRoute>
            } />
            <Route path="/session/:id" element={
              <ProtectedRoute roles={['student']}>
                <Chat />
              </ProtectedRoute>
            } />
            <Route path="/summary/:id" element={
              <ProtectedRoute roles={['student']}>
                <Summary />
              </ProtectedRoute>
            } />

            {/* Admin */}
            <Route path="/admin" element={
              <ProtectedRoute roles={['admin']}>
                <UploadProvider>
                  <AdminLayout />
                </UploadProvider>
              </ProtectedRoute>
            }>
              <Route index element={<AdminDashboard />} />
              <Route path="students" element={<AdminStudents />} />
              <Route path="students/:id" element={<AdminStudentDetail />} />
              <Route path="parents" element={<AdminParents />} />
              <Route path="flagged" element={<AdminFlagged />} />
              <Route path="settings" element={<AdminSettings />} />
              <Route path="books" element={<AdminBooks />} />
            </Route>

            {/* Parent */}
            <Route path="/parent" element={
              <ProtectedRoute roles={['parent', 'admin']}>
                <ParentLayout />
              </ProtectedRoute>
            }>
              <Route index element={<ParentDashboard />} />
              <Route path="children/:id" element={<ParentChildDetail />} />
              <Route path="notifications" element={<ParentNotifications />} />
            </Route>

            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}
