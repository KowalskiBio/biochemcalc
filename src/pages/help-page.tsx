import { HelpCircle } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function HelpPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Nápověda</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Informace o aplikaci a návody k použití.
        </p>
      </div>

      <div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="size-5" />O aplikaci
            </CardTitle>
            <CardDescription>
              BioCal - generátor variabilních biochemických výpočtových úloh.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-foreground-muted text-sm">
              Aplikace umožňuje vytvářet témata, kategorie a sady šablon pro generování jedinečných
              biochemických výpočtových úloh. Importujte testovací data, generujte varianty a
              exportujte výsledky.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
