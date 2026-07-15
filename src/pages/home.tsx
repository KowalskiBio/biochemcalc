import { cva } from "class-variance-authority"
import { motion } from "framer-motion"
import { Link } from "react-router-dom"
// Import shadcn/ui components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
// Czech translations
import { cs } from "@/i18n/cs"
import { cn } from "@/lib/utils"

/**
 * Home Page Component
 * Dashboard with stats cards and primary CTA to start the wizard
 */

const statsCardVariants = cva("w-full sm:w-[240px] lg:w-[280px]")

const ctaCardVariants = cva("w-full max-w-2xl mx-auto")

const quickActionVariants = cva(
  "flex items-center justify-between p-4 bg-muted/50 rounded-lg hover:bg-muted transition-colors cursor-pointer",
)

export function HomePage() {
  // Mock data for stats - would be replaced with actual data
  const stats = [
    {
      label: "Témata",
      value: "0",
      description: "Vytvořená témata",
      icon: "📚",
    },
    {
      label: cs.home.stats.constants,
      value: "0",
      description: "Definované konstanty",
      icon: "⚗️",
    },
    {
      label: "Sady",
      value: "0",
      description: "Připravené sady úloh",
      icon: "📋",
    },
    {
      label: cs.home.stats.generatedTasks,
      value: "0",
      description: "Celkem vygenerováno",
      icon: "✨",
    },
  ]

  // Quick actions
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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      {/* Welcome section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">{cs.home.welcome}</h1>
        <p className="text-foreground-secondary max-w-2xl">{cs.home.description}</p>
      </motion.div>

      {/* Stats cards */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {stats.map((stat, index) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 + index * 0.1 }}
            className={cn(statsCardVariants())}
          >
            <Card className="h-full">
              <CardHeader className="pb-2">
                <CardDescription className="text-sm">{stat.label}</CardDescription>
                <CardTitle className="text-3xl font-bold">{stat.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-foreground-muted">{stat.description}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Primary CTA */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="flex justify-center"
      >
        <Card className={cn(ctaCardVariants())}>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{cs.home.cta.primary}</CardTitle>
            <CardDescription className="max-w-md mx-auto">
              Spusťte průvodce a vytvořte svůj první soubor úkolů pro studenty.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button asChild size="lg" className="min-w-[200px]">
              <Link to="/topics">Otevřít témata</Link>
            </Button>
          </CardContent>
        </Card>
      </motion.div>

      {/* Quick actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.7 }}
        className="grid grid-cols-1 lg:grid-cols-3 gap-4"
      >
        <div className="lg:col-span-1">
          <h2 className="text-lg font-semibold text-foreground mb-4">{cs.home.quickActions}</h2>
        </div>
        <div className="lg:col-span-2 space-y-2">
          {quickActions.map((action, index) => (
            <motion.div
              key={action.path}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.8 + index * 0.1 }}
            >
              <Link to={action.path} className="block">
                <div className={cn(quickActionVariants())}>
                  <span className="font-medium text-foreground">{action.title}</span>
                  <span className="text-foreground-muted text-sm">→</span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Recent activity placeholder */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 1.1 }}
        className="pt-4 border-t border-border"
      >
        <h2 className="text-lg font-semibold text-foreground mb-4">{cs.home.recentActivity}</h2>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-foreground-muted">{cs.home.noRecentActivity}</p>
            <p className="text-xs text-foreground-muted mt-2">
              Zatím zde nejsou žádné nedávné aktivity.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
