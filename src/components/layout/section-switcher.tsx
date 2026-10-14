import { cva } from "class-variance-authority"
import { Atom, ChefHat, ChevronDown, FlaskConical, Lock } from "lucide-react"
import type React from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useSection } from "@/hooks/use-section"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/api"
import type { Section } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"

export const SECTION_ICONS: Record<
  Section,
  React.ComponentType<{ className?: string; strokeWidth?: number }>
> = {
  calculations: FlaskConical,
  biomolecules: Atom,
}

export const SECTION_ORDER: Section[] = ["calculations", "biomolecules"]

/**
 * `light` sits in the teacher top bar; `sidebar` in the dark student
 * sidebar header.
 */
const triggerVariants = cva(
  "flex items-center gap-2 rounded-[4px] border px-3 py-1.5 text-sm font-medium transition-colors duration-100",
  {
    variants: {
      tone: {
        light: "border-border text-foreground hover:bg-muted",
        sidebar: "w-full border-white/10 text-[hsl(var(--sidebar-foreground))] hover:bg-white/5",
      },
      locked: {
        true: "cursor-not-allowed opacity-60 hover:bg-transparent",
        false: "cursor-pointer",
      },
    },
    defaultVariants: { tone: "light", locked: false },
  },
)

interface SectionSwitcherProps {
  tone: "light" | "sidebar"
  /** Called after a section is picked — closes the student mobile drawer. */
  onSwitch?: () => void
}

export function SectionSwitcher({ tone, onSwitch }: SectionSwitcherProps) {
  const { toast } = useToast()
  const { section, allowed, locked, switchTo } = useSection()
  const switcherLabel = cs.sections.switcherLabel[useAuthStore((s) => s.user?.role ?? "student")]
  const Icon = SECTION_ICONS[section]

  const handleSelect = async (next: Section) => {
    try {
      await switchTo(next)
      onSwitch?.()
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.sections.switchError),
        variant: "destructive",
      })
    }
  }

  const label = (
    <>
      <Icon className="size-4 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{cs.sections[section]}</span>
    </>
  )

  if (locked) {
    const hint = cs.sections.lockedHint.replace("{section}", cs.sections[section])
    return (
      <div className="flex flex-col gap-1">
        <div
          className={cn(triggerVariants({ tone, locked: true }))}
          title={hint}
          aria-disabled="true"
        >
          {label}
          <Lock className="ml-auto size-3.5 shrink-0" strokeWidth={1.75} />
        </div>
        {tone === "sidebar" && (
          <p className="text-[11px] leading-snug text-[hsl(var(--sidebar-foreground))]/50">
            {hint}
          </p>
        )}
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(triggerVariants({ tone, locked: false }))}
        aria-label={switcherLabel}
      >
        {label}
        <ChevronDown className="ml-auto size-3.5 shrink-0 opacity-60" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={tone === "light" ? "end" : "start"} className="w-60">
        <DropdownMenuLabel>{switcherLabel}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SECTION_ORDER.filter((s) => allowed.includes(s)).map((s) => {
          const ItemIcon = SECTION_ICONS[s]
          return (
            <DropdownMenuItem
              key={s}
              onSelect={() => void handleSelect(s)}
              className={cn("gap-2", s === section && "font-semibold")}
              aria-current={s === section ? "true" : undefined}
            >
              <ItemIcon className="size-4" strokeWidth={1.75} />
              {cs.sections[s]}
            </DropdownMenuItem>
          )
        })}
        <DropdownMenuItem disabled className="gap-2 italic">
          <ChefHat className="size-4" strokeWidth={1.75} />
          {cs.sections.cooking}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
