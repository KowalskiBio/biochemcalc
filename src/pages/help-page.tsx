import { motion } from "framer-motion"
import { HelpCircle } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function HelpPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <h1 className="text-2xl font-bold text-foreground">Nápověda</h1>
        <p className="text-foreground-secondary mt-1">Informace o aplikaci a návody k použití.</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="size-5" />O aplikaci
            </CardTitle>
            <CardDescription>
              BiochemCalc — generátor variabilních biochemických výpočtových úloh.
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
      </motion.div>
    </motion.div>
  )
}
