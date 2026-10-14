import { ChefHat, ChevronRight, FlaskConical } from "lucide-react"
import { useState } from "react"
import { SECTION_ICONS, SECTION_ORDER } from "@/components/layout/section-switcher"
import { useSection } from "@/hooks/use-section"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/api"
import type { Section } from "@/lib/types"
import { useAuthStore } from "@/stores/auth-store"

/**
 * The one-time "what do you want to learn?" screen for a user who can reach
 * both sections but has never chosen one. Picking saves the choice on the
 * server, so this never shows again (the switcher changes it later).
 */
export function SectionPicker() {
  const { toast } = useToast()
  const { switchTo } = useSection()
  const [pending, setPending] = useState<Section | null>(null)
  const copy = cs.sections.picker[useAuthStore((s) => s.user?.role ?? "student")]

  const handlePick = async (section: Section) => {
    setPending(section)
    try {
      await switchTo(section)
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.sections.switchError),
        variant: "destructive",
      })
      setPending(null)
    }
  }

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-4">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-[4px] bg-[hsl(var(--accent))]">
            <FlaskConical className="size-5 text-[hsl(var(--card))]" strokeWidth={1.75} />
          </div>
          <span className="text-lg font-semibold tracking-tight">BioCal</span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{copy.description}</p>
        </div>
        <div className="grid gap-3">
          {SECTION_ORDER.map((section) => {
            const Icon = SECTION_ICONS[section]
            return (
              <button
                key={section}
                type="button"
                onClick={() => void handlePick(section)}
                disabled={pending !== null}
                className="group flex items-center gap-4 rounded-[6px] border border-border bg-card p-4 text-left transition-colors duration-150 hover:border-primary/50 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <Icon className="size-6 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="font-semibold tracking-tight">{cs.sections[section]}</span>
                <ChevronRight
                  className="ml-auto size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                  strokeWidth={1.75}
                />
              </button>
            )
          })}
          <div
            className="flex items-center gap-4 rounded-[6px] border border-dashed border-border p-4 text-muted-foreground"
            aria-disabled="true"
          >
            <ChefHat className="size-6 shrink-0" strokeWidth={1.75} />
            <span className="italic">{cs.sections.cooking}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
