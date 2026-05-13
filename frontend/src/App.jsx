import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { GoogleOAuthProvider } from '@react-oauth/google'
import { AuthProvider } from './auth/AuthContext'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { UploadProvider } from './context/UploadContext'
import Login from './pages/Login'
import Unauthorized from './pages/Unauthorized'
import Chat from './pages/Chat'
import Summary from './pages/Summary'
import StudentLayout from './pages/student/StudentLayout'
import StudentHome from './pages/student/StudentHome'
import StudentPractice from './pages/student/StudentPractice'
import StudentProgress from './pages/student/StudentProgress'
import StudentStudyTime from './pages/student/StudentStudyTime'
import StudentAchievements from './pages/student/StudentAchievements'
import StudentMistakes from './pages/student/StudentMistakes'
import ExamMode from './pages/ExamMode'
import FlashcardMode from './pages/FlashcardMode'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminStudents from './pages/admin/AdminStudents'
import AdminStudentDetail from './pages/admin/AdminStudentDetail'
import AdminParents from './pages/admin/AdminParents'
import AdminFlagged from './pages/admin/AdminFlagged'
import AdminSettings from './pages/admin/AdminSettings'
import AdminBooks from './pages/admin/AdminBooks'
import AdminAnalytics from './pages/admin/AdminAnalytics'
import ParentLayout from './pages/parent/ParentLayout'
import ParentDashboard from './pages/parent/ParentDashboard'
import ParentChildDetail from './pages/parent/ParentChildDetail'
import ParentNotifications from './pages/parent/ParentNotifications'
import { ToastProvider } from './context/ToastContext'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function App() {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID} onScriptLoadError={() => console.error('GSI script failed')}>
      <AuthProvider>
        <ToastProvider>
        <BrowserRouter>
          <Routes>
            {/* Public */}
            <Route path="/login" element={<Login />} />
            <Route path="/unauthorized" element={<Unauthorized />} />

            {/* Student — sidebar layout */}
            <Route path="/" element={
              <ProtectedRoute roles={['student']}>
                <StudentLayout />
              </ProtectedRoute>
            }>
              <Route index element={<Navigate to="/home" replace />} />
              <Route path="home"         element={<StudentHome />} />
              <Route path="practice"     element={<StudentPractice />} />
              <Route path="progress"     element={<StudentProgress />} />
              <Route path="study-time"   element={<StudentStudyTime />} />
              <Route path="achievements" element={<StudentAchievements />} />
              <Route path="mistakes"     element={<StudentMistakes />} />
            </Route>

            {/* Exam and Flashcard — full-screen, no sidebar */}
            <Route path="/exam" element={
              <ProtectedRoute roles={['student']}>
                <ExamMode />
              </ProtectedRoute>
            } />
            <Route path="/flashcard" element={
              <ProtectedRoute roles={['student']}>
                <FlashcardMode />
              </ProtectedRoute>
            } />

            {/* Session / Summary pages (full-screen, no sidebar) */}
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
              <Route path="analytics" element={<AdminAnalytics />} />
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
        </ToastProvider>
      </AuthProvider>
    </GoogleOAuthProvider>
  )
}
