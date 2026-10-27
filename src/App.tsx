import { useEffect } from "react"
import { Navigate, Route, Routes } from "react-router-dom"

import { RequireAuth } from "@/components/auth/route-guard"
import { AppShell } from "@/components/layout/app-shell"
import { StudentShell } from "@/components/layout/student-shell"
import { allowedSections } from "@/hooks/use-section"
import { BiomoleculesHistoryPage } from "@/pages/biomolecules-history-page"
import { BiomoleculesCategoryPage, BiomoleculesPage } from "@/pages/biomolecules-page"
import { BiomoleculesProjectionPage } from "@/pages/biomolecules-projection-page"
import { BiomoleculesQuizPage } from "@/pages/biomolecules-quiz-page"
import { BiomoleculesReportsPage } from "@/pages/biomolecules-reports-page"
import { BiomoleculesStreakPage } from "@/pages/biomolecules-streak-page"
import { BiomoleculesTestPage } from "@/pages/biomolecules-test-page"
import { BulkImportPage } from "@/pages/bulk-import-page"
import { ConstantsPage } from "@/pages/constants-page"
import { DatabazePage } from "@/pages/databaze-page"
import { ForgotPasswordPage } from "@/pages/forgot-password-page"
import { FormulasPage } from "@/pages/formulas-page"
import { HelpPage } from "@/pages/help-page"
import { HistoryPage } from "@/pages/history-page"
import { LoginPage } from "@/pages/login-page"
import { PeptidovkaPage, PeptidovkaRunPage } from "@/pages/peptidovka-page"
import { PeptidovkaSettingsPage } from "@/pages/peptidovka-settings-page"
import { ProjektyPage } from "@/pages/projekty-page"
import { RegisterPage } from "@/pages/register-page"
import { ReportsPage } from "@/pages/reports-page"
import { ResetPasswordPage } from "@/pages/reset-password-page"
import { SetDetailPage } from "@/pages/set-detail-page"
import { SettingsPage } from "@/pages/settings-page"
import { StudentLeaderboardPage } from "@/pages/student-leaderboard-page"
import { StudentPracticePage } from "@/pages/student-practice-page"
import { StudentSettingsPage } from "@/pages/student-settings-page"
import { StudentStreakActivePage } from "@/pages/student-streak-active-page"
import { StudentStreakResultsPage } from "@/pages/student-streak-results-page"
import { StudentStreakSetupPage } from "@/pages/student-streak-setup-page"
import { StudentTestModePage } from "@/pages/student-test-mode-page"
import { StudentTestPage } from "@/pages/student-test-page"
import { StudentTestResultsPage } from "@/pages/student-test-results-page"
import { StudentTestStartPage } from "@/pages/student-test-start-page"
import { TestyPage } from "@/pages/testy-page"
import { TopicDetailPage } from "@/pages/topic-detail-page"
import { TopicsPage } from "@/pages/topics-page"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

/**
 * A teacher manages the sections their account is scoped to (`user.sections`,
 * set by the admin) — normally both. The server enforces the same split:
 * `/api/cmd/*` needs calculations access, Biomolekuly editing needs
 * biomolecules access.
 */
function TeacherRoutes() {
  const access = useAuthStore((s) => s.user?.sections ?? "both")
  const allowed = allowedSections(access)
  const hasCalculations = allowed.includes("calculations")
  const hasBiomolecules = allowed.includes("biomolecules")
  const home = hasCalculations ? "/topics" : "/biomolekuly"

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        {hasCalculations && (
          <>
            <Route path="/topics" element={<TopicsPage />} />
            <Route path="/topics/:topicId" element={<TopicDetailPage />} />
            <Route path="/sets/:setId" element={<SetDetailPage />} />
            <Route path="/projekty" element={<ProjektyPage />} />
            <Route path="/testy" element={<TestyPage />} />
            <Route path="/databaze" element={<DatabazePage />} />
            <Route path="/vzorce" element={<FormulasPage />} />
            <Route path="/bulk-import" element={<BulkImportPage />} />
            <Route path="/constants" element={<ConstantsPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/hlaseni" element={<ReportsPage />} />
          </>
        )}
        {hasBiomolecules && (
          <>
            <Route path="/biomolekuly" element={<BiomoleculesPage />} />
            <Route path="/biomolekuly/projekce" element={<BiomoleculesProjectionPage />} />
            <Route path="/biomolekuly/hlaseni" element={<BiomoleculesReportsPage />} />
            <Route path="/biomolekuly/historie" element={<BiomoleculesHistoryPage />} />
            <Route path="/biomolekuly/peptidovka" element={<PeptidovkaSettingsPage />} />
            <Route path="/biomolekuly/:categoryId" element={<BiomoleculesCategoryPage />} />
            <Route
              path="/biomolekuly/:categoryId/procvicovani"
              element={<BiomoleculesQuizPage />}
            />
          </>
        )}
        <Route path="/leaderboard" element={<StudentLeaderboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Routes>
    </AppShell>
  )
}

/**
 * A student sees only the sections their invite code unlocked
 * (`user.sections`): laboratory calculations (the practice generator and
 * tests), Biomolekuly, or both — plus the leaderboard and their own
 * profile, which every section shares. Anything else redirects to the
 * student's home. The teacher pages all call `/api/cmd/*`, which is
 * teacher-only server-side, so there is nothing for a student to reach
 * there; the calculations API itself is gated server-side as well
 * (`require_calculations`).
 *
 * TODO(biomolekuly-launch): once the Biomolekuly section is ready, show
 * calculations-only students (every account that predates section-scoped
 * invite codes) a one-time pop-up inviting them to check out Biomolekuly.
 */
function StudentRoutes() {
  const access = useAuthStore((s) => s.user?.sections ?? "calculations")
  const allowed = allowedSections(access)
  const hasCalculations = allowed.includes("calculations")
  const hasBiomolecules = allowed.includes("biomolecules")
  const home = hasCalculations ? <StudentPracticePage /> : <Navigate to="/biomolekuly" replace />

  return (
    <StudentShell>
      <Routes>
        <Route path="/" element={home} />
        {hasCalculations && (
          <>
            <Route path="/test" element={<StudentTestModePage />} />
            <Route path="/test/uvodni" element={<StudentTestStartPage kind="uvodni" />} />
            <Route path="/test/uvodni/active" element={<StudentTestPage />} />
            <Route path="/test/uvodni/results" element={<StudentTestResultsPage />} />
            <Route path="/test/prubezny" element={<StudentTestStartPage kind="prubezny" />} />
            <Route path="/test/prubezny/active" element={<StudentTestPage />} />
            <Route path="/test/prubezny/results" element={<StudentTestResultsPage />} />
            <Route path="/test/ucen" element={<StudentStreakSetupPage kind="apprentice" />} />
            <Route path="/test/mistr" element={<StudentStreakSetupPage kind="master" />} />
            <Route path="/test/streak/active" element={<StudentStreakActivePage />} />
            <Route path="/test/streak/results" element={<StudentStreakResultsPage />} />
          </>
        )}
        <Route path="/leaderboard" element={<StudentLeaderboardPage />} />
        {hasBiomolecules && (
          <>
            <Route path="/biomolekuly" element={<BiomoleculesPage />} />
            <Route path="/biomolekuly/procvicovani" element={<BiomoleculesQuizPage />} />
            <Route path="/biomolekuly/test" element={<BiomoleculesTestPage />} />
            <Route
              path="/biomolekuly/test/ucen"
              element={<BiomoleculesStreakPage kind="apprentice" />}
            />
            <Route
              path="/biomolekuly/test/mistr"
              element={<BiomoleculesStreakPage kind="master" />}
            />
            <Route path="/biomolekuly/peptidovka" element={<PeptidovkaPage />} />
            <Route
              path="/biomolekuly/peptidovka/ucen"
              element={<PeptidovkaRunPage mode="ucen" />}
            />
            <Route
              path="/biomolekuly/peptidovka/mistr"
              element={<PeptidovkaRunPage mode="mistr" />}
            />
            <Route path="/biomolekuly/:categoryId" element={<BiomoleculesCategoryPage />} />
            <Route
              path="/biomolekuly/:categoryId/procvicovani"
              element={<BiomoleculesQuizPage />}
            />
          </>
        )}
        <Route path="/settings" element={<StudentSettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </StudentShell>
  )
}

export function App() {
  const fetchMe = useAuthStore((s) => s.fetchMe)
  const user = useAuthStore((s) => s.user)

  useEffect(() => {
    const theme = useUiStore.getState().theme
    document.documentElement.classList.toggle("dark", theme === "dark")
  }, [])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              {user?.role === "teacher" ? <TeacherRoutes /> : <StudentRoutes />}
            </RequireAuth>
          }
        />
      </Routes>
    </div>
  )
}
