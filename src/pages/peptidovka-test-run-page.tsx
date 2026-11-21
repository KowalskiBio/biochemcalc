import { AlertTriangle, ArrowLeft } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import {
  type Biomolecule,
  biomoleculesApi,
  type PeptidovkaTestStudentView,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import { nLeftOrientationDeg } from "@/lib/peptides"
import {
  chainFingerprints,
  generatePeptidovkaTestRun,
  isPeptideAnswerCorrect,
} from "@/lib/peptides/test"
import { cn } from "@/lib/utils"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.peptidovka.testy
const peptidovkaStrings = cs.peptidovka

/** Učeň's canonical reading direction, degraded to 0 on a geometry hiccup. */
function nLeftDeg(smiles: string, nIndex: number): number {
  try {
    return nLeftOrientationDeg(smiles, nIndex) ?? 0
  } catch {
    return 0
  }
}

/** The run state: typed answer per peptide, null = not yet answered. */
interface RunState {
  index: number
  typed: (string | null)[]
  verdicts: (boolean | undefined)[]
}

interface StoredAttemptProgress {
  fingerprints: string[]
  index: number
  typed: (string | null)[]
  verdicts: (boolean | undefined)[]
}

function attemptStorageKey(attemptId: string): string {
  return `peptidovka-test-attempt-${attemptId}`
}

function loadStoredProgress(attemptId: string): StoredAttemptProgress | null {
  try {
    const raw = window.localStorage.getItem(attemptStorageKey(attemptId))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as StoredAttemptProgress
    if (!Array.isArray(parsed.fingerprints) || !Array.isArray(parsed.typed)) return null
    return parsed
  } catch {
    return null
  }
}

function saveStoredProgress(attemptId: string, run: { chains: string[] }, state: RunState): void {
  try {
    const payload: StoredAttemptProgress = {
      fingerprints: chainFingerprints(run.chains),
      index: state.index,
      typed: state.typed,
      verdicts: state.verdicts,
    }
    window.localStorage.setItem(attemptStorageKey(attemptId), JSON.stringify(payload))
  } catch {
    // Storage unavailable: the run loses its resume point.
  }
}

function clearStoredProgress(attemptId: string): void {
  try {
    window.localStorage.removeItem(attemptStorageKey(attemptId))
  } catch {
    // Nothing to clean up.
  }
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function formatDeadline(value: string): string {
  return new Date(value).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function PeptidovkaTestRunPage() {
  const params = useParams<{ testId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  const routedView = (location.state as { view?: PeptidovkaTestStudentView } | null)?.view ?? null
  const [fetchedView, setFetchedView] = useState<PeptidovkaTestStudentView | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  useEffect(() => {
    if (routedView !== null || fetchedView !== null || fetchFailed || !loaded) return
    let cancelled = false
    void (async () => {
      try {
        const tests = await biomoleculesApi.availablePeptidovkaTests()
        if (cancelled) return
        const match = tests.find((entry) => entry.test.id === params.testId) ?? null
        if (match !== null) setFetchedView(match)
        else setFetchFailed(true)
      } catch {
        if (!cancelled) setFetchFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [routedView, fetchedView, fetchFailed, loaded, params.testId])

  const view = routedView ?? fetchedView
  const test = view?.test ?? null
  const attempt = view?.attempt ?? null

  // Submitted attempts belong to the result route.
  useEffect(() => {
    if (view !== null && attempt !== null && attempt.submittedAt !== null) {
      navigate(`/biomolekuly/peptidovka/test/zadane/${test?.id ?? ""}/vysledek`, {
        state: { view },
        replace: true,
      })
    }
  }, [view, attempt, test?.id, navigate])

  // Generation + resume, decided once per (test, attempt, dataset).
  const [prepared, setPrepared] = useState<{
    chains: string[]
    structures: { smiles: string; nIndex: number }[]
    initial: RunState
    materialChanged: boolean
  } | null>(null)
  useEffect(() => {
    if (!loaded || test === null || attempt === null || prepared !== null) return
    if (attempt.submittedAt !== null) return // the redirect effect handles it
    const run = generatePeptidovkaTestRun(
      test,
      attempt.seed,
      allMolecules as readonly Biomolecule[],
    )
    if (run === null) {
      setPrepared({
        chains: [],
        structures: [],
        initial: { index: 0, typed: [], verdicts: [] },
        materialChanged: true,
      })
      return
    }
    const stored = loadStoredProgress(attempt.attemptId)
    if (stored !== null) {
      const fingerprints = chainFingerprints(run.chains)
      const sameMaterial =
        stored.fingerprints.length === fingerprints.length &&
        stored.fingerprints.every((fingerprint, index) => fingerprint === fingerprints[index])
      if (!sameMaterial) {
        setPrepared({
          chains: run.chains,
          structures: run.structures,
          initial: { index: 0, typed: [], verdicts: [] },
          materialChanged: true,
        })
        return
      }
      const index = Math.min(Math.max(stored.index, 0), run.chains.length - 1)
      setPrepared({
        chains: run.chains,
        structures: run.structures,
        initial: {
          index,
          typed: stored.typed.slice(0, run.chains.length),
          verdicts: stored.verdicts.slice(0, run.chains.length),
        },
        materialChanged: false,
      })
      return
    }
    setPrepared({
      chains: run.chains,
      structures: run.structures,
      initial: {
        index: 0,
        typed: run.chains.map(() => null),
        verdicts: run.chains.map(() => undefined),
      },
      materialChanged: false,
    })
  }, [loaded, test, attempt, allMolecules, prepared])

  const [state, setState] = useState<RunState | null>(null)
  useEffect(() => {
    if (prepared !== null && prepared.materialChanged === false && state === null) {
      setState(prepared.initial)
    }
  }, [prepared, state])
  const runState = state ?? prepared?.initial ?? null

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deadlineHit, setDeadlineHit] = useState(false)
  const submittedRef = useRef(false)
  const autoFailedRef = useRef(false)

  const answer = useCallback(
    (value: string) => {
      if (runState === null || submittedRef.current) return
      const index = runState.index
      if (runState.typed[index] !== null) return // decided already
      const chain = prepared?.chains[index]
      if (chain === undefined) return
      const verdict = isPeptideAnswerCorrect(chain, value)
      const next: RunState = {
        index: runState.index,
        typed: runState.typed.map((typed, i) => (i === index ? value : typed)),
        verdicts: runState.verdicts.map((current, i) => (i === index ? verdict : current)),
      }
      setState(next)
      if (attempt !== null)
        saveStoredProgress(attempt.attemptId, { chains: prepared?.chains ?? [] }, next)
    },
    [runState, prepared, attempt],
  )

  const advance = useCallback(() => {
    if (runState === null || submittedRef.current) return
    const next: RunState = { ...runState, index: runState.index + 1 }
    setState(next)
    if (attempt !== null)
      saveStoredProgress(attempt.attemptId, { chains: prepared?.chains ?? [] }, next)
  }, [runState, prepared, attempt])

  const submit = useCallback(
    async (auto: boolean) => {
      if (attempt === null || test === null || submittedRef.current) return
      if (prepared === null || prepared.chains.length === 0) return
      const verdicts = prepared.chains.map(
        (_, index) => runStateRef.current?.verdicts[index] === true,
      )
      const correctCount = verdicts.filter((verdict) => verdict).length
      submittedRef.current = true
      setSubmitting(true)
      setSubmitError(null)
      try {
        await biomoleculesApi.submitPeptidovkaTestAttempt({
          attemptId: attempt.attemptId,
          totalCount: prepared.chains.length,
          correctCount,
          // The student's typed chains ride along so the teacher's detail
          // view can show exactly what was answered; verdicts mirror them.
          detailJson: JSON.stringify({
            typed: runStateRef.current?.typed ?? [],
            correct: verdicts.map((verdict) => verdict === true),
          }),
        })
        clearStoredProgress(attempt.attemptId)
        const submittedView: PeptidovkaTestStudentView = {
          test,
          attempt: {
            ...attempt,
            submittedAt: new Date().toISOString(),
            totalCount: prepared.chains.length,
            correctCount,
            detailJson: JSON.stringify({
              typed: runStateRef.current?.typed ?? [],
              correct: verdicts.map((verdict) => verdict === true),
            }),
          },
        }
        navigate(`/biomolekuly/peptidovka/test/zadane/${test.id}/vysledek`, {
          state: {
            view: submittedView,
            review: {
              chains: prepared.chains,
              structures: prepared.structures,
              typed: runStateRef.current?.typed ?? [],
              verdicts,
            },
          },
        })
      } catch (error) {
        submittedRef.current = false
        setSubmitting(false)
        if (auto) {
          setDeadlineHit(true)
          autoFailedRef.current = true
        }
        setSubmitError(extractErrorMessage(error, testyStrings.submitError))
      }
    },
    [attempt, test, prepared, navigate],
  )
  const runStateRef = useRef(runState)
  runStateRef.current = runState
  const submitRef = useRef(submit)
  submitRef.current = submit

  // Deadline clock: auto-submit fires 30 s before the server's cutoff; a
  // failed auto-submit never hammers the server again (manual retry stays).
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  useEffect(() => {
    if (test === null || attempt === null) return
    if (attempt.submittedAt !== null) return
    const deadline = new Date(test.availableTo).getTime()
    const tick = () => {
      const left = deadline - Date.now()
      setRemainingMs(left)
      if (left <= 30_000 && !autoFailedRef.current) {
        void submitRef.current(true)
      }
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [test, attempt])

  if (!loaded || view === null) {
    if (fetchFailed) {
      return (
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <p className="text-sm text-destructive">{testyStrings.loadError}</p>
          <Button variant="outline" asChild>
            <Link to="/biomolekuly/peptidovka">{testyStrings.backToHub}</Link>
          </Button>
        </div>
      )
    }
    return (
      <div className="mx-auto w-full max-w-2xl py-8 text-center text-sm text-muted-foreground">
        …
      </div>
    )
  }

  if (test === null || attempt === null) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <p className="text-sm text-destructive">{testyStrings.loadError}</p>
        <Button variant="outline" asChild>
          <Link to="/biomolekuly/peptidovka">{testyStrings.backToHub}</Link>
        </Button>
      </div>
    )
  }

  if (prepared?.materialChanged === true) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">{test.title}</h1>
        <div className="rounded-[4px] border p-4">
          <p className="font-medium">{testyStrings.materialChangedTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {testyStrings.materialChangedDescription}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link to="/biomolekuly/peptidovka">{testyStrings.backToHub}</Link>
        </Button>
      </div>
    )
  }

  const index = runState?.index ?? 0
  const structure = prepared?.structures[index]
  const chain = prepared?.chains[index]
  const typed = runState?.typed[index] ?? null
  const verdict = runState?.verdicts[index]
  const total = prepared?.chains.length ?? 0

  if (structure === undefined || chain === undefined || runState === null) {
    return (
      <div className="mx-auto w-full max-w-2xl py-8 text-center text-sm text-muted-foreground">
        …
      </div>
    )
  }

  const [typedValue = ""] = typed !== null ? [typed] : []
  void typedValue

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/biomolekuly/peptidovka"
          className="inline-flex items-center gap-1.5 rounded-[4px] py-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          {testyStrings.backToHub}
        </Link>
        <div className="flex items-center gap-3">
          {remainingMs !== null && remainingMs > 0 && !submittedRef.current && (
            <span
              className={cn(
                "font-mono tabular text-sm",
                remainingMs < 60_000 ? "font-semibold text-destructive" : "text-muted-foreground",
              )}
            >
              {testyStrings.timeRemaining}: {formatRemaining(remainingMs)}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void submitRef.current(false)}
            disabled={submitting || total === 0}
          >
            {submitting ? testyStrings.submitting : testyStrings.submit}
          </Button>
        </div>
      </div>

      <div className="rounded-[4px] border bg-card p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-semibold tracking-tight">{test.title}</p>
            <p className="text-xs text-muted-foreground">
              {testyStrings.availableUntil.replace("{time}", formatDeadline(test.availableTo))}
            </p>
          </div>
          <p className="whitespace-nowrap font-mono tabular text-sm text-muted-foreground">
            {Math.min(index + 1, total)} / {total}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{testyStrings.autoSubmitNotice}</p>
      </div>

      {submitError !== null && (
        <div className="rounded-[4px] border border-destructive/50 bg-destructive/5 p-3">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4" />
            {submitError}
          </p>
          {deadlineHit && (
            <p className="mt-1 text-xs text-muted-foreground">{testyStrings.deadlineNotice}</p>
          )}
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => void submitRef.current(false)}
            disabled={submitting}
          >
            {testyStrings.retrySubmit}
          </Button>
        </div>
      )}

      <div className="space-y-2 py-2 text-center">
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {testyStrings.peptideNumber.replace("{number}", String(index + 1))}
        </p>
        <div className="flex min-w-0 justify-center">
          <StructureView
            smiles={structure.smiles}
            orientationDeg={nLeftDeg(structure.smiles, structure.nIndex)}
            monochrome={test.monochrome}
            size={240}
            grow
            maxWidth={640}
            title={peptidovkaStrings.structureLabel}
            className="max-w-full !h-auto [&>svg]:h-auto [&>svg]:max-w-full"
          />
        </div>
      </div>

      {verdict === undefined ? (
        <PeptideAnswerForm key={index} onSubmit={(value) => answer(value)} />
      ) : (
        <div className="space-y-3" aria-live="polite">
          <div className="flex items-center justify-center gap-3">
            <Input
              value={typed ?? ""}
              readOnly
              aria-label={peptidovkaStrings.answerLabel}
              className={cn(
                "max-w-xs text-center font-mono uppercase tracking-[0.2em]",
                "font-medium disabled:opacity-100",
                verdict
                  ? "border-accent bg-accent/5 text-accent"
                  : "border-destructive bg-destructive/10 text-destructive",
              )}
              disabled
            />
            <p className={cn("text-sm font-medium", verdict ? "text-accent" : "text-destructive")}>
              {verdict ? quizCorrectText() : quizIncorrectText()}
            </p>
          </div>
          {!verdict && (
            <div className="rounded-[4px] border bg-muted/50 px-4 py-3 text-center">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {peptidovkaStrings.correctAnswerLabel}
              </p>
              <p className="break-all font-mono text-2xl font-semibold tracking-[0.3em]">{chain}</p>
            </div>
          )}
          <div className="flex justify-center">
            {index < total - 1 ? (
              <Button onClick={advance}>{testyStrings.nextPeptide}</Button>
            ) : (
              <Button onClick={() => void submitRef.current(false)} disabled={submitting}>
                {submitting ? testyStrings.submitting : testyStrings.submit}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function quizCorrectText(): string {
  return cs.biomolekuly.quiz.correct
}

function quizIncorrectText(): string {
  return cs.biomolekuly.quiz.incorrect
}

function PeptideAnswerForm({ onSubmit }: { onSubmit: (value: string) => void }) {
  const [value, setValue] = useState("")
  const canSubmit = value.trim() !== ""

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-3">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              if (canSubmit) onSubmit(value)
            }
          }}
          placeholder={peptidovkaStrings.answerPlaceholder}
          aria-label={peptidovkaStrings.answerLabel}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="max-w-xs text-center font-mono uppercase tracking-[0.2em]"
        />
        <Button onClick={() => onSubmit(value)} disabled={!canSubmit}>
          {peptidovkaStrings.checkAnswer}
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">{peptidovkaStrings.answerHint}</p>
    </div>
  )
}
