import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

/**
 * Whether to show teacher-only controls on a page both roles share. A
 * teacher previewing the app as a student ("Náhled studenta") gets the
 * student view, the same way App.tsx swaps them onto StudentRoutes.
 */
export function useTeacherView(): boolean {
  const isTeacher = useAuthStore((s) => s.user?.role === "teacher")
  const studentView = useUiStore((s) => s.studentView)
  return isTeacher && !studentView
}
