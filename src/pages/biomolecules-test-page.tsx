import { Crown, Swords } from "lucide-react"
import { Link } from "react-router-dom"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cs } from "@/i18n/cs"

const MODES = [
  {
    to: "/biomolekuly/test/ucen",
    icon: Swords,
    title: cs.test.modeUcenTitle,
    description: cs.biomolekuly.test.modeUcenDescription,
  },
  {
    to: "/biomolekuly/test/mistr",
    icon: Crown,
    title: cs.test.modeMistrTitle,
    description: cs.biomolekuly.test.modeMistrDescription,
  },
] as const

/**
 * Biomolekuly's test hub, mirroring the calculations section's mode picker:
 * the two endless streak runs (Učeň/Mistr), here drawing from every molecule
 * category at once — Učeň as easy multiple choice, Mistr as hard open-ended
 * answers. The mode titles are the shared `cs.test` ones; the descriptions
 * are Biomolekuly-specific because the scoping differs (no topic picker
 * exists here, so saying "z vybraného tématu" would promise a step this
 * section doesn't have).
 */
export function BiomoleculesTestPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.test.startTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.test.modePickerDescription}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODES.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to} className="block h-full">
            <Card className="h-full cursor-pointer transition-colors hover:border-primary hover:bg-primary/5">
              <CardHeader>
                <Icon className="size-6 text-primary" strokeWidth={1.75} />
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
