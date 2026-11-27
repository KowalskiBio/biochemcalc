import { AlertTriangle, ArrowLeft } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { RichText } from "@/components/ui/rich-text"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { type BiomoleculeTestStudentView, biomoleculesApi } from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import type {
  QuizMolecule,
  QuizOption,
  QuizQuestion,
} from "@/lib/molecules/quiz/question-generator"
import {
  generateTestSession,
  questionFingerprints,
  tagTestQuestions,
  testQuestionPool,
} from "@/lib/molecules/test"
import { autoSubmitMarginMs, remainingTimeMs } from "@/lib/test-clock"
import { cn } from "@/lib/utils"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.biomolekuly.testy
const quizStrings = cs.biomolekuly.quiz

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** The run state the page owns: one selected option key per question. */
interface RunState {
  index: number
  /** Selected option key per question index; null = unanswered. */
  selections: (string | null)[]
}

interface StoredAttemptProgress {
  uids: string[]
  /** Content hashes of the generated questions – detect prompt/option edits. */
  fingerprints: string[]
  index: number
  selections: (string | null)[]
}

function attemptStorageKey(attemptId: string): string {
  return `biomolecule-test-attempt-${attemptId}`
}

function loadStoredProgress(attemptId: string): StoredAttemptProgress | null {
  try {
    const raw = window.localStorage.getItem(attemptStorageKey(attemptId))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as StoredAttemptProgress
    if (
      !Array.isArray(parsed.uids) ||
      !Array.isArray(parsed.selections) ||
      !Array.isArray(parsed.fingerprints)
    )
      return null
    return parsed
  } catch {
    return null
  }
}

function saveStoredProgress(
  attemptId: string,
  questions: QuizQuestion[],
  fingerprints: string[],
  state: RunState,
): void {
  try {
    const payload: StoredAttemptProgress = {
      uids: questions.map((question) => question.uid ?? ""),
      fingerprints,
      index: state.index,
      selections: state.selections,
    }
    window.localStorage.setItem(attemptStorageKey(attemptId), JSON.stringify(payload))
  } catch {
    // Storage unavailable (private mode): the run loses its resume point.
  }
}

function clearStoredProgress(attemptId: string): void {
  try {
    window.localStorage.removeItem(attemptStorageKey(attemptId))
  } catch {
    // Nothing to clean up.
  }
}

/** Text options carry no display string – resolve name/letter from the pool. */
function optionLabel(molecules: QuizMolecule[], option: QuizOption): string {
  const molecule = molecules.find((m) => m.id === option.moleculeId)
  if (!molecule) return option.key
  return option.display === "letter" ? (molecule.oneLetter ?? option.key) : molecule.name
}

function PromptView({
  prompt,
  monochrome,
}: {
  prompt: QuizQuestion["prompt"]
  monochrome: boolean
}) {
  if (prompt.kind === "structure" && prompt.smiles) {
    return (
      <StructureView
        smiles={prompt.smiles}
        projection={prompt.projection}
        haworth={prompt.haworth ?? true}
        fischer={prompt.fischer ?? true}
        orientationDeg={prompt.orientationDeg}
        size={220}
        grow
        monochrome={monochrome}
        title={quizStrings.promptStructureLabel}
        className="mx-auto"
      />
    )
  }
  if (prompt.kind === "letter") {
    return <p className="font-mono tabular text-4xl font-semibold tracking-tight">{prompt.text}</p>
  }
  if (prompt.kind === "characteristic") {
    return (
      <p className="text-xl font-semibold tracking-tight">
        {prompt.predicate ? quizStrings.characteristicPrompts[prompt.predicate] : prompt.text}
      </p>
    )
  }
  return (
    <p className="text-2xl font-semibold tracking-tight">
      <RichText text={prompt.text} />
    </p>
  )
}

function OptionButton({
  option,
  molecules,
  monochrome,
  index,
  decided,
  isSelected,
  onSelect,
}: {
  option: QuizOption
  molecules: QuizMolecule[]
  monochrome: boolean
  index: number
  decided: boolean
  isSelected: boolean
  onSelect: () => void
}) {
  const stateClass = decided
    ? isSelected
      ? "border-primary bg-primary/5"
      : "opacity-60"
    : "cursor-pointer hover:border-primary/50"

  return (
    <button
      type="button"
      disabled={decided}
      onClick={onSelect}
      aria-label={
        option.display === "structure"
          ? quizStrings.structureOptionLabel.replace("{index}", String(index + 1))
          : undefined
      }
      className={cn(
        "flex min-h-[44px] items-center justify-center rounded-[4px] border bg-card p-3",
        "transition-colors duration-150",
        FOCUS_RING_CLASS,
        stateClass,
      )}
    >
      {option.display === "structure" ? (
        <div aria-hidden="true">
          <StructureView
            smiles={option.smiles ?? ""}
            projection={option.projection}
            haworth={option.haworth ?? true}
            fischer={option.fischer ?? true}
            orientationDeg={option.orientationDeg}
            size={150}
            monochrome={monochrome}
          />
        </div>
      ) : (
        <span
          className={
            option.display === "letter" ? "font-mono tabular text-lg" : "text-sm font-medium"
          }
        >
          <RichText text={optionLabel(molecules, option)} />
        </span>
      )}
    </button>
  )
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

/** Per-type breakdown for detailJson, mirroring scoreSummary's byType shape. */
function breakdownByType(
  questions: QuizQuestion[],
  verdicts: (boolean | undefined)[],
): Record<string, { correct: number; total: number }> {
  const byType: Record<string, { correct: number; total: number }> = {}
  questions.forEach((question, index) => {
    const verdict = verdicts[index]
    if (verdict === undefined) return
    const bucket = byType[question.type] ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (verdict) bucket.correct += 1
    byType[question.type] = bucket
  })
  return byType
}

export function BiomoleculesTestRunPage() {
  const params = useParams<{ testId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  // The hub passes the fetched view through router state; a direct URL entry
  // falls back to re-fetching the student list.
  const routedView = (location.state as { view?: BiomoleculeTestStudentView } | null)?.view ?? null
  const [fetchedView, setFetchedView] = useState<BiomoleculeTestStudentView | null>(null)
  const [fetchFailed, setFetchFailed] = useState(false)
  useEffect(() => {
    if (routedView !== null || fetchedView !== null || fetchFailed || !loaded) return
    let cancelled = false
    void (async () => {
      try {
        const tests = await biomoleculesApi.availableBiomoleculeTests()
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
  const offsetMs = view?.clockOffsetMs ?? 0

  // Submitted attempts belong to the result route.
  useEffect(() => {
    if (view !== null && attempt !== null && attempt.submittedAt !== null) {
      navigate(`/biomolekuly/test/zadane/${test?.id ?? ""}/vysledek`, {
        state: { view },
        replace: true,
      })
    }
  }, [view, attempt, test?.id, navigate])

  // Generation + resume, decided once per (test, attempt, dataset).
  const [prepared, setPrepared] = useState<{
    questions: QuizQuestion[]
    /** Hashes of the questions as served, so later edits cannot restamp them. */
    fingerprints: string[]
    initial: RunState
    materialChanged: boolean
  } | null>(null)
  useEffect(() => {
    if (!loaded || test === null || attempt === null || prepared !== null) return
    if (attempt.submittedAt !== null) return // the redirect effect handles it
    const questions = generateTestSession(test, attempt.seed, allMolecules)
    if (questions === null || questions.length === 0) {
      setPrepared({
        questions: [],
        fingerprints: [],
        initial: { index: 0, selections: [] },
        materialChanged: true,
      })
      return
    }
    const tagged = tagTestQuestions(questions, attempt.seed)
    const fingerprints = questionFingerprints(
      tagged,
      testQuestionPool(test, allMolecules)?.molecules ?? [],
    )
    const stored = loadStoredProgress(attempt.attemptId)
    if (stored !== null) {
      const sameMaterial =
        stored.uids.length === tagged.length &&
        stored.fingerprints.length === fingerprints.length &&
        stored.uids.every((uid, index) => uid === tagged[index]?.uid) &&
        stored.fingerprints.every((fingerprint, index) => fingerprint === fingerprints[index])
      if (!sameMaterial) {
        setPrepared({
          questions: tagged,
          fingerprints,
          initial: { index: 0, selections: [] },
          materialChanged: true,
        })
        return
      }
      // Same seed ⇒ same options, so stored keys re-grade reliably.
      const index = Math.min(Math.max(stored.index, 0), tagged.length - 1)
      setPrepared({
        questions: tagged,
        fingerprints,
        initial: { index, selections: stored.selections.slice(0, tagged.length) },
        materialChanged: false,
      })
      return
    }
    const freshSelections: (string | null)[] = tagged.map(() => null)
    setPrepared({
      questions: tagged,
      fingerprints,
      initial: { index: 0, selections: freshSelections },
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

  const questions = prepared?.questions ?? []
  const fingerprints = prepared?.fingerprints ?? []
  const decided = (index: number): boolean | undefined => {
    const key = runState?.selections[index]
    if (key === undefined || key === null) return undefined
    const option = questions[index]?.options.find((candidate) => candidate.key === key)
    return option?.correct === true
  }

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [deadlineHit, setDeadlineHit] = useState(false)
  const submittedRef = useRef(false)

  const select = useCallback(
    (optionKey: string) => {
      if (runState === null || submittedRef.current) return
      const question = questions[runState.index]
      if (question === undefined) return
      if (runState.selections[runState.index] !== null) return // decided already
      const next: RunState = {
        ...runState,
        selections: runState.selections.map((current, index) =>
          index === runState.index ? optionKey : current,
        ),
      }
      setState(next)
      saveStoredProgress(attempt?.attemptId ?? "", questions, fingerprints, next)
    },
    [runState, questions, fingerprints, attempt],
  )

  const advance = useCallback(() => {
    if (runState === null || submittedRef.current) return
    const next: RunState = { ...runState, index: runState.index + 1 }
    setState(next)
    saveStoredProgress(attempt?.attemptId ?? "", questions, fingerprints, next)
  }, [runState, questions, fingerprints, attempt])

  const submit = useCallback(
    async (auto: boolean) => {
      if (view === null || attempt === null || test === null || submittedRef.current) return
      // The auto-submit clock can tick before generation lands; an empty
      // batch has nothing to submit and would only earn a server rejection.
      const questionsNow = prepared?.questions ?? []
      if (prepared === null || questionsNow.length === 0) return
      const verdicts = questionsNow.map((_, index) => decidedRef.current(index))
      const correctCount = verdicts.filter((verdict) => verdict === true).length
      submittedRef.current = true
      setSubmitting(true)
      setSubmitError(null)
      try {
        await biomoleculesApi.submitBiomoleculeTestAttempt({
          attemptId: attempt.attemptId,
          totalCount: questionsNow.length,
          correctCount,
          detailJson: JSON.stringify({
            byType: breakdownByType(questionsNow, verdicts),
            fingerprints: prepared.fingerprints,
            // Per-question answers: the teacher's detail view regenerates the
            // batch from the attempt seed and matches these by uid.
            answers: questionsNow.map((question, index) => ({
              uid: question.uid ?? `${attempt.seed}-${index}`,
              type: question.type,
              correct: verdicts[index] === true,
              selectedKey: runStateRef.current?.selections[index] ?? null,
            })),
          }),
        })
        clearStoredProgress(attempt.attemptId)
        const submittedView: BiomoleculeTestStudentView = {
          ...view,
          attempt: {
            ...attempt,
            submittedAt: new Date().toISOString(),
            totalCount: questionsNow.length,
            correctCount,
            detailJson: JSON.stringify({
              byType: breakdownByType(questionsNow, verdicts),
              answers: questionsNow.map((question, index) => ({
                uid: question.uid ?? `${attempt.seed}-${index}`,
                type: question.type,
                correct: verdicts[index] === true,
                selectedKey: runStateRef.current?.selections[index] ?? null,
              })),
            }),
          },
        }
        navigate(`/biomolekuly/test/zadane/${test.id}/vysledek`, {
          state: {
            view: submittedView,
            review: {
              questions: questionsNow,
              verdicts,
              selections: runStateRef.current?.selections ?? [],
            },
          },
        })
      } catch (error) {
        submittedRef.current = false
        setSubmitting(false)
        if (auto) {
          setDeadlineHit(true)
          // A failed auto-submit never retries itself – the manual button
          // stays, and a permanent rejection (deadline passed server-side)
          // would otherwise be hammered once a second.
          autoFailedRef.current = true
        }
        setSubmitError(extractErrorMessage(error, testyStrings.submitError))
      }
    },
    [view, attempt, test, prepared, navigate],
  )
  const decidedRef = useRef(decided)
  decidedRef.current = decided
  const runStateRef = useRef(runState)
  runStateRef.current = runState
  const submitRef = useRef(submit)
  submitRef.current = submit
  const autoFailedRef = useRef(false)

  // Deadline clock: auto-submit fires 30 s before the server's cutoff so a
  // slow network still lands inside the 60 s server-side grace. The interval
  // stops once the window is far enough past its end for even the grace to
  // be gone, and a failed auto-submit never hammers the server again.
  const [remainingMs, setRemainingMs] = useState<number | null>(null)
  useEffect(() => {
    if (test === null || attempt === null) return
    if (attempt.submittedAt !== null) return
    const timeLeft = () => remainingTimeMs(test.availableTo, offsetMs, Date.now())
    const margin = autoSubmitMarginMs(timeLeft())
    const tick = () => {
      const left = timeLeft()
      setRemainingMs(left)
      if (left <= margin && !autoFailedRef.current) {
        void submitRef.current(true)
      }
    }
    tick()
    const interval = window.setInterval(tick, 1000)
    // A hidden tab gets its timers throttled to once a minute; ticking on
    // visibility keeps the auto-submit near the intended T-30 s mark.
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [test, attempt, offsetMs])

  const question = questions[runState?.index ?? 0]
  const total = questions.length
  const molecules = useMemo<QuizMolecule[]>(() => {
    if (test === null) return []
    const pool = testQuestionPool(test, allMolecules)
    return pool?.molecules ?? []
  }, [test, allMolecules])

  if (!loaded || view === null) {
    if (fetchFailed) {
      return (
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <p className="text-sm text-destructive">{testyStrings.loadError}</p>
          <Button variant="outline" asChild>
            <Link to="/biomolekuly/test">{testyStrings.backToHub}</Link>
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
          <Link to="/biomolekuly/test">{testyStrings.backToHub}</Link>
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
          <Link to="/biomolekuly/test">{testyStrings.backToHub}</Link>
        </Button>
      </div>
    )
  }

  if (question === undefined || runState === null) {
    return (
      <div className="mx-auto w-full max-w-2xl py-8 text-center text-sm text-muted-foreground">
        …
      </div>
    )
  }

  const currentVerdict = decided(runState.index)
  const answeredSoFar = runState.selections.filter((selection) => selection !== null).length

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/biomolekuly/test"
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
            {Math.min(runState.index + 1, total)} / {total}
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
          {quizStrings.types[question.type]}
        </p>
        <PromptView prompt={question.prompt} monochrome={test.monochrome} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {question.options.map((option, i) => (
          <OptionButton
            key={option.key}
            option={option}
            molecules={molecules}
            monochrome={test.monochrome}
            index={i}
            decided={currentVerdict !== undefined}
            isSelected={option.key === runState.selections[runState.index]}
            onSelect={() => select(option.key)}
          />
        ))}
      </div>

      {currentVerdict !== undefined && (
        <div className="flex items-center justify-between gap-4" aria-live="polite">
          <p className="text-sm font-medium text-muted-foreground">{testyStrings.answerSaved}</p>
          {runState.index < total - 1 ? (
            <Button onClick={advance}>{quizStrings.nextQuestion}</Button>
          ) : (
            // Last question answered: the flow's next action IS the submission.
            <Button onClick={() => void submitRef.current(false)} disabled={submitting}>
              {submitting ? testyStrings.submitting : testyStrings.submit}
            </Button>
          )}
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {answeredSoFar} / {total}
      </p>
    </div>
  )
}
