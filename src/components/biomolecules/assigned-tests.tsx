import { CheckCircle2, Dna, FlaskConical, Play, RotateCcw } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import {
  type BiomoleculeTestStudentView,
  biomoleculesApi,
  type PeptidovkaTestStudentView,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"

const testyStrings = cs.biomolekuly.testy
const peptidovkaTestyStrings = cs.peptidovka.testy

/**
 * One teacher-assigned test a student can see: a classic Biomolekuly test or
 * a Peptidovka test. Both kinds share the window/attempt shape, so the Test
 * page and the home page list them side by side.
 */
export type AssignedTest =
  | { kind: "biomolecules"; view: BiomoleculeTestStudentView }
  | { kind: "peptidovka"; view: PeptidovkaTestStudentView }

function pluralForm(count: number, forms: { one: string; few: string; many: string }): string {
  const form = count === 1 ? forms.one : count >= 2 && count <= 4 ? forms.few : forms.many
  return form.replace("{count}", String(count))
}

export function questionCountText(count: number): string {
  return pluralForm(count, testyStrings.questionCount)
}

function itemCountText(item: AssignedTest): string {
  return item.kind === "biomolecules"
    ? questionCountText(item.view.test.questionCount)
    : pluralForm(item.view.test.peptideCount, peptidovkaTestyStrings.peptideCount)
}

function itemTotal(item: AssignedTest): number {
  return item.kind === "biomolecules" ? item.view.test.questionCount : item.view.test.peptideCount
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

/** Server-corrected "now" for one listing, so windows don't depend on the device clock. */
function serverNowMs(item: AssignedTest): number {
  return Date.now() + item.view.clockOffsetMs
}

/** Whether a student can sit this test right now: window open and not yet submitted. */
export function isAssignedTestOpen(item: AssignedTest): boolean {
  const { test, attempt } = item.view
  if (attempt?.submittedAt) return false
  const now = serverNowMs(item)
  return new Date(test.availableFrom).getTime() <= now && now < new Date(test.availableTo).getTime()
}

function routeBase(item: AssignedTest): string {
  return item.kind === "biomolecules"
    ? `/biomolekuly/test/zadane/${item.view.test.id}`
    : `/biomolekuly/peptidovka/test/zadane/${item.view.test.id}`
}

/**
 * Loads both kinds of assigned tests at once. A failure of one kind still
 * shows the other; the error line covers whichever failed.
 */
export function useAssignedTests(enabled = true) {
  const [tests, setTests] = useState<AssignedTest[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!enabled) {
      setTests([])
      return
    }
    setLoadError(null)
    const [classic, peptidovka] = await Promise.allSettled([
      biomoleculesApi.availableBiomoleculeTests(),
      biomoleculesApi.availablePeptidovkaTests(),
    ])
    const merged: AssignedTest[] = []
    if (classic.status === "fulfilled") {
      for (const view of classic.value) merged.push({ kind: "biomolecules", view })
    }
    if (peptidovka.status === "fulfilled") {
      for (const view of peptidovka.value) merged.push({ kind: "peptidovka", view })
    }
    const failure =
      classic.status === "rejected"
        ? classic.reason
        : peptidovka.status === "rejected"
          ? peptidovka.reason
          : null
    if (failure !== null) setLoadError(extractErrorMessage(failure, testyStrings.loadError))
    // Soonest deadline first — what needs doing first sits on top.
    merged.sort(
      (a, b) =>
        new Date(a.view.test.availableTo).getTime() - new Date(b.view.test.availableTo).getTime(),
    )
    setTests(merged)
  }, [enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  return { tests, loadError, reload }
}

/** Start/resume/open-result for one assigned test, with the run/result pages' router state. */
export function useOpenAssignedTest(onStale: () => Promise<void>) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [openingId, setOpeningId] = useState<string | null>(null)

  const open = async (item: AssignedTest) => {
    const { view } = item
    if (view.attempt?.submittedAt) {
      navigate(`${routeBase(item)}/vysledek`, { state: { view } })
      return
    }
    setOpeningId(view.test.id)
    try {
      const started =
        item.kind === "biomolecules"
          ? await biomoleculesApi.startBiomoleculeTestAttempt(view.test.id)
          : await biomoleculesApi.startPeptidovkaTestAttempt(view.test.id)
      const nextView = {
        ...view,
        attempt: { ...started, detailJson: view.attempt?.detailJson ?? null },
      }
      const destination = started.submittedAt ? "vysledek" : "pisat"
      navigate(`${routeBase(item)}/${destination}`, { state: { view: nextView } })
    } catch (error) {
      toast({
        title: testyStrings.startError,
        description: extractErrorMessage(error, testyStrings.startError),
        variant: "destructive",
      })
      // The card can outlive its window by a few seconds. Re-read the server's
      // view so a just-closed or already-submitted test resolves to fresh state.
      await onStale()
    } finally {
      setOpeningId(null)
    }
  }

  return { open, openingId }
}

interface AssignedTestCardProps {
  item: AssignedTest
  openingId: string | null
  onOpen: (item: AssignedTest) => void
}

export function AssignedTestCard({ item, openingId, onOpen }: AssignedTestCardProps) {
  const { test, attempt } = item.view
  const submitted = attempt?.submittedAt != null
  const expired = !submitted && new Date(test.availableTo).getTime() <= serverNowMs(item)
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
  const KindIcon = item.kind === "peptidovka" ? Dna : FlaskConical
  const isOpening = openingId === test.id

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              <KindIcon className="size-3" strokeWidth={1.75} />
              {item.kind === "peptidovka"
                ? cs.studentHome.kindPeptidovka
                : cs.studentHome.kindBiomolecules}
            </p>
            <CardTitle className="text-lg leading-snug">{test.title}</CardTitle>
          </div>
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
          <span className="block">{itemCountText(item)}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-5 text-sm">
          {submitted ? (
            <span className="font-mono tabular font-semibold text-accent">
              {testyStrings.score
                .replace("{correct}", String(attempt.correctCount ?? 0))
                .replace("{total}", String(attempt.totalCount ?? itemTotal(item)))}
            </span>
          ) : attempt ? (
            <span className="text-muted-foreground">{testyStrings.statusInProgress}</span>
          ) : null}
        </div>
        <Button
          onClick={() => onOpen(item)}
          disabled={openingId !== null || (expired && attempt == null)}
          variant={submitted ? "outline" : "default"}
        >
          <ActionIcon className="size-4" />
          {isOpening ? testyStrings.opening : action}
        </Button>
      </CardContent>
    </Card>
  )
}

export function AssignedTestsSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: count }, (_, index) => index).map((item) => (
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
  )
}

/**
 * The Test page's "Zadané testy" section: every teacher-assigned test the
 * student can see — classic and Peptidovka alike — with its attempt status.
 */
export function AssignedTestsSection() {
  const { tests, loadError, reload } = useAssignedTests()
  const { open, openingId } = useOpenAssignedTest(reload)

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
            <Button variant="outline" size="sm" onClick={() => void reload()}>
              {testyStrings.retry}
            </Button>
          </CardContent>
        </Card>
      )}

      {tests === null ? (
        <AssignedTestsSkeleton />
      ) : tests.length === 0 && !loadError ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">{testyStrings.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">{testyStrings.emptyDescription}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {tests.map((item) => (
            <AssignedTestCard
              key={`${item.kind}-${item.view.test.id}`}
              item={item}
              openingId={openingId}
              onOpen={(next) => void open(next)}
            />
          ))}
        </div>
      )}
    </section>
  )
}
