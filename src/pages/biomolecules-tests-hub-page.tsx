import { ClipboardList, FileText, ListChecks, Pencil } from "lucide-react"
import { Link } from "react-router-dom"

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cs } from "@/i18n/cs"

const hubStrings = cs.biomolekuly.testy.hub

const CARDS = [
  {
    to: "/biomolekuly/peptidovka/testy/vytvorit",
    icon: Pencil,
    title: hubStrings.createPeptidovkaTitle,
    description: hubStrings.createPeptidovkaDescription,
  },
  {
    to: "/biomolekuly/testy/vytvorit/klasicky",
    icon: FileText,
    title: hubStrings.createClassicTitle,
    description: hubStrings.createClassicDescription,
  },
  {
    to: "/biomolekuly/peptidovka/testy/vysledky",
    icon: ClipboardList,
    title: hubStrings.resultsPeptidovkaTitle,
    description: hubStrings.resultsPeptidovkaDescription,
  },
  {
    to: "/biomolekuly/testy/vysledky",
    icon: ListChecks,
    title: hubStrings.resultsClassicTitle,
    description: hubStrings.resultsClassicDescription,
  },
] as const

/** Teacher hub for all test types: create + results for Peptidovka and the classic tests. */
export function BiomoleculesTestsHubPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {hubStrings.title}
        </h1>
        <p className="text-muted-foreground text-sm">{hubStrings.description}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {CARDS.map(({ to, icon: Icon, title, description }) => (
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
