import { Crown, Swords, Timer } from "lucide-react"
import { Link } from "react-router-dom"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cs } from "@/i18n/cs"

const MODES = [
  {
    to: "/test/cvicny",
    icon: Timer,
    title: cs.test.modeCvicnyTitle,
    description: cs.test.modeCvicnyDescription,
  },
  {
    to: "/test/ucen",
    icon: Swords,
    title: cs.test.modeUcenTitle,
    description: cs.test.modeUcenDescription,
  },
  {
    to: "/test/mistr",
    icon: Crown,
    title: cs.test.modeMistrTitle,
    description: cs.test.modeMistrDescription,
  },
] as const

/**
 * The first choice a student makes before testing themselves: a classic
 * timed batch ("Cvičný test"), an endless scoped run that ends on the first
 * mistake ("Učeň"), or the same but drawing from every topic ("Mistr").
 */
export function StudentTestModePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.test.startTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.test.modePickerDescription}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
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
