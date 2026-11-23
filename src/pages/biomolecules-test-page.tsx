import { CheckCircle2, Crown, Play, RotateCcw, Swords } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { type BiomoleculeTestStudentView, biomoleculesApi } from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"

const testyStrings = cs.biomolekuly.testy

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

export function questionCountText(count: number): string {
  const forms = testyStrings.questionCount
  const form = count === 1 ? forms.one : count >= 2 && count <= 4 ? forms.few : forms.many
  return form.replace("{count}", String(count))
}

function formatWindowDate(value: string): string {
  return new Date(value).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Cards share the result payload with the run/result routes through router state. */
export function biomoleculeTestRouteState(view: BiomoleculeTestStudentView) {
  return { view }
}

function AssignedTests() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [tests, setTests] = useState<BiomoleculeTestStudentView[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)

  const loadTests = useCallback(async () => {
    setLoadError(null)
    try {
      setTests(await biomoleculesApi.availableBiomoleculeTests())
    } catch (error) {
      setLoadError(extractErrorMessage(error, testyStrings.loadError))
      setTests((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    void loadTests()
  }, [loadTests])

  const openTest = async (view: BiomoleculeTestStudentView) => {
    const { test, attempt } = view
    if (attempt?.submittedAt) {
      navigate(`/biomolekuly/test/zadane/${test.id}/vysledek`, {
        state: biomoleculeTestRouteState(view),
      })
      return
    }

    setOpeningId(test.id)
    try {
      const started = await biomoleculesApi.startBiomoleculeTestAttempt(test.id)
      const nextView: BiomoleculeTestStudentView = {
        test,
        serverNow: view.serverNow,
        attempt: {
          ...started,
          detailJson: attempt?.detailJson ?? null,
        },
      }
      const destination = started.submittedAt ? "vysledek" : "pisat"
      navigate(`/biomolekuly/test/zadane/${test.id}/${destination}`, {
        state: biomoleculeTestRouteState(nextView),
      })
    } catch (error) {
      toast({
        title: testyStrings.startError,
        description: extractErrorMessage(error, testyStrings.startError),
        variant: "destructive",
      })
      // The card can outlive its window by a few seconds. Re-read the server's
      // view so a just-closed or already-submitted test resolves to fresh state.
      await loadTests()
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <section className="space-y-4 border-t border-border pt-6" aria-labelledby="assigned-tests">
      <div>
        <h2 id="assigned-tests" className="text-xl font-semibold tracking-tight text-foreground">
          {testyStrings.hubTitle}
        </h2>
        <p className="text-sm text-muted-foreground">{testyStrings.hubDescription}</p>
      </div>

      {loadError && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-destructive">{loadError}</p>
            <Button variant="outline" size="sm" onClick={() => void loadTests()}>
              {testyStrings.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {tests === null ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((item) => (
            <Card key={item}>
              <CardHeader>
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-4 w-full" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-36" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tests.length === 0 && !loadError ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">{testyStrings.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{testyStrings.emptyDescription}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {tests.map((view) => {
            const { test, attempt } = view
            const submitted = attempt?.submittedAt != null
            const expired = !submitted && new Date(test.availableTo).getTime() <= Date.now()
            const status = submitted
              ? testyStrings.statusSubmitted
              : expired
                ? testyStrings.statusClosed
                : attempt
                  ? testyStrings.statusInProgress
                  : testyStrings.statusNotStarted
            const action = submitted
              ? testyStrings.showResult
              : attempt
                ? testyStrings.resume
                : testyStrings.start
            const ActionIcon = submitted ? CheckCircle2 : attempt ? RotateCcw : Play
            const isOpening = openingId === test.id

            return (
              <Card key={test.id} className="overflow-hidden">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <CardTitle className="text-lg leading-snug">{test.title}</CardTitle>
                    <Badge
                      variant="outline"
                      className={submitted ? "border-accent/40 text-accent" : undefined}
                    >
                      {status}
                    </Badge>
                  </div>
                  <CardDescription className="space-y-1">
                    <span className="block">
                      {testyStrings.windowLabel}: {formatWindowDate(test.availableFrom)} –{" "}
                      {formatWindowDate(test.availableTo)}
                    </span>
                    <span className="block">{questionCountText(test.questionCount)}</span>
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-h-5 text-sm">
                    {submitted ? (
                      <span className="font-mono tabular font-semibold text-accent">
                        {testyStrings.score
                          .replace("{correct}", String(attempt.correctCount ?? 0))
                          .replace("{total}", String(attempt.totalCount ?? test.questionCount))}
                      </span>
                    ) : attempt ? (
                      <span className="text-muted-foreground">{testyStrings.statusInProgress}</span>
                    ) : null}
                  </div>
                  <Button
                    onClick={() => void openTest(view)}
                    disabled={openingId !== null || (expired && attempt == null)}
                    variant={submitted ? "outline" : "default"}
                  >
                    <ActionIcon className="size-4" />
                    {isOpening ? testyStrings.opening : action}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </section>
  )
}

/**
 * Biomolekuly's test hub: the two endless practice modes, followed by the
 * teacher-assigned, once-only tests whose attempts live on the server.
 */
export function BiomoleculesTestPage() {
  return (
    <div className="space-y-8">
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

      <AssignedTests />
    </div>
  )
}
