import { useCallback, useEffect } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import type { Role, Section, SectionAccess } from "@/lib/types"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

/**
 * App sections. Which ones a user can reach comes from the server
 * (`user.sections` — inherited from a student's invite code, always "both"
 * for teachers); which one they're *in* comes from the URL, falling back on
 * shared pages to the section they were last in, and then to the one they
 * last chose in the switcher (`user.preferredSection`, saved server-side).
 * There is deliberately no hard-coded default: a user with both sections
 * who has never chosen gets the one-time picker (`needsChoice`).
 */

/** Pages every section shows in its sidebar — they don't imply a section. */
const SHARED_PATHS = ["/leaderboard", "/settings", "/help"]

export function allowedSections(access: SectionAccess): Section[] {
  return access === "both" ? ["calculations", "biomolecules"] : [access]
}

export function sectionHome(section: Section, role: Role): string {
  if (section === "biomolecules") return "/biomolekuly"
  return role === "teacher" ? "/topics" : "/"
}

/** The section a path belongs to, or null for a page shared by all sections. */
export function sectionForPath(pathname: string): Section | null {
  if (pathname === "/biomolekuly" || pathname.startsWith("/biomolekuly/")) return "biomolecules"
  if (SHARED_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null
  return "calculations"
}

export interface SectionState {
  /** The section the UI is showing now. */
  section: Section
  allowed: Section[]
  /** Only one section is reachable — the switcher is shown but disabled. */
  locked: boolean
  /** Both sections are reachable and the user has never picked one. */
  needsChoice: boolean
  /** Save `section` as the user's choice and go to its home page. */
  switchTo: (section: Section) => Promise<void>
}

export function useSection(): SectionState {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const setPreferredSection = useAuthStore((s) => s.setPreferredSection)
  const lastSection = useUiStore((s) => s.lastSection)
  const setLastSection = useUiStore((s) => s.setLastSection)

  const access = user?.sections ?? "calculations"
  const allowed = allowedSections(access)
  const locked = allowed.length === 1
  const pathSection = sectionForPath(location.pathname)

  // Remember the section of the last section-specific page, so a shared
  // page (leaderboard, settings) keeps the sidebar the user came from.
  useEffect(() => {
    if (pathSection && allowedSections(access).includes(pathSection)) setLastSection(pathSection)
  }, [pathSection, access, setLastSection])

  const candidate = pathSection ?? lastSection ?? user?.preferredSection ?? allowed[0]
  const section = allowed.includes(candidate) ? candidate : allowed[0]

  const switchTo = useCallback(
    async (next: Section) => {
      if (!user) return
      if (next !== user.preferredSection) await setPreferredSection(next)
      setLastSection(next)
      navigate(sectionHome(next, user.role))
    },
    [user, setPreferredSection, setLastSection, navigate],
  )

  return {
    section,
    allowed,
    locked,
    needsChoice: !locked && user?.preferredSection == null,
    switchTo,
  }
}

/**
 * Once per shell mount: if the user arrived on the calculations landing page
 * (the post-login default) but their saved section is Biomolekuly, send them
 * there instead.
 */
export function useLandingRedirect() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)

  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberately runs only on mount — later navigation to "/" is the user's own choice
  useEffect(() => {
    if (!user) return
    const allowed = allowedSections(user.sections)
    const target = allowed.length === 1 ? allowed[0] : (user.preferredSection ?? null)
    const onCalcLanding = location.pathname === "/" || location.pathname === "/topics"
    if (target === "biomolecules" && onCalcLanding) {
      navigate(sectionHome("biomolecules", user.role), { replace: true })
    }
  }, [])
}
