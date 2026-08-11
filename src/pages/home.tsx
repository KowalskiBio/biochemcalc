import { Link } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { cs } from "@/i18n/cs"

/**
 * Home Page Component
 * Dashboard with stats and primary CTA to start the wizard
 */

export function HomePage() {
  const today = new Date()
  const formattedDate = `${today.getDate().toString().padStart(2, "0")}.${(today.getMonth() + 1).toString().padStart(2, "0")}.${today.getFullYear()}`

  const stats = [
    {
      label: "Témata",
      value: "0",
      description: "Vytvořená témata",
    },
    {
      label: cs.home.stats.constants,
      value: "0",
      description: "Definované konstanty",
    },
    {
      label: "Sady",
      value: "0",
      description: "Připravené sady úloh",
    },
    {
      label: cs.home.stats.generatedTasks,
      value: "0",
      description: "Celkem vygenerováno",
    },
  ]

  const quickActions = [
    {
      title: "Importovat testovací data",
      path: "/topics",
    },
    {
      title: "Přidat novou konstantu",
      path: "/constants",
    },
    {
      title: "Zobrazit historii",
      path: "/history",
    },
  ]

  return (
    <div className="space-y-6">
      {/* Welcome section */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent mb-2">
            PŘEHLED
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{cs.home.welcome}</h1>
          <p className="text-muted-foreground max-w-2xl mt-1">{cs.home.description}</p>
        </div>
        <div className="font-mono text-[12px] tabular text-muted-foreground">{formattedDate}</div>
      </div>

      {/* Stats panel - single bordered rule-separated panel */}
      <div className="rounded-[4px] border bg-card">
        <div className="divide-x divide-border grid grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="p-5">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                {stat.label}
              </div>
              <div className="font-mono text-3xl tabular text-foreground">{stat.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA block - hairline bordered strip */}
      <div className="border border-border rounded-[4px] p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Spusťte průvodce a vytvořte svůj první soubor úkolů pro studenty.
            </p>
          </div>
          <Button asChild size="lg">
            <Link to="/topics">Otevřít témata</Link>
          </Button>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
          RYCHLÉ AKCE
        </div>
        <div className="space-y-1">
          {quickActions.map((action) => (
            <Link key={action.path} to={action.path} className="block">
              <div className="flex items-center justify-between p-4 hover:bg-muted/60 transition-colors rounded-[4px] border-b border-border last:border-0">
                <span className="text-sm font-medium">{action.title}</span>
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent activity placeholder */}
      <div className="pt-4 border-t border-border">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
          NEDÁVNÁ AKTIVITA
        </div>
        <div className="border border-dashed border-border rounded-[4px] py-10 text-center">
          <p className="text-muted-foreground">{cs.home.noRecentActivity}</p>
          <p className="text-xs text-muted-foreground mt-2">
            Zatím zde nejsou žádné nedávné aktivity.
          </p>
        </div>
      </div>
    </div>
  )
}
