import { ChefHat } from "lucide-react"
import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cs } from "@/i18n/cs"
import { authApi } from "@/lib/auth-api"
import { useAuthStore } from "@/stores/auth-store"
import { useUiStore } from "@/stores/ui-store"

const BIOMOLECULES_LAUNCH = "biomolecules-launch"
const strings = cs.notices.biomoleculesLaunch

/**
 * The one-time "Biomolekuly are open" popup. Migration v67 queued it for
 * every student who had only Laboratorní výpočty; it shows on their next
 * visit and is dismissed on the server however it closes (button, X,
 * Escape, outside click), so it never comes back – on any device. A
 * teacher previewing as a student never has one queued. A failed fetch
 * just skips it this time; a failed dismissal means it shows once more.
 */
export function LaunchNotice() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id)
  const studentView = useUiStore((s) => s.studentView)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!userId || studentView) return
    let cancelled = false
    authApi
      .notices()
      .then((notices) => {
        if (!cancelled && notices.includes(BIOMOLECULES_LAUNCH)) setOpen(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId, studentView])

  const close = (thenOpenLibrary: boolean) => {
    setOpen(false)
    void authApi.dismissNotice(BIOMOLECULES_LAUNCH).catch(() => {})
    if (thenOpenLibrary) navigate("/biomolekuly")
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close(false)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <ChefHat className="size-8 text-primary" strokeWidth={1.5} aria-hidden="true" />
          <DialogTitle>{strings.title}</DialogTitle>
          <DialogDescription className="text-base text-foreground">
            {strings.body}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => close(false)}>
            {strings.close}
          </Button>
          <Button onClick={() => close(true)}>{strings.open}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
