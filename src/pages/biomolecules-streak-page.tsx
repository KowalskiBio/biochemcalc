import { ArrowLeft, RotateCcw, Target, Timer, Trophy } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { type BiomoleculeStreakKind, biomoleculesApi } from "@/lib/biomolecules-api"
import {
  type CategoryQuizConfig,
  generatableQuizTypes,
  generateQuizSession,
  getCategoryQuizConfig,
  isOpenAnswerCorrect,
  normalizeQuizAnswer,
  type QuizMode,
  type QuizMolecule,
  type QuizOption,
  type QuizPrompt,
  type QuizQuestion,
  type QuizQuestionType,
} from "@/lib/molecules/quiz"
import { cn, formatDecimalComma } from "@/lib/utils"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useMoleculeCategories,
} from "@/stores/biomolecule-data-store"

const quizStrings = cs.biomolekuly.quiz
const streakStrings = cs.streak

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** One category's endless-run material: its quiz config plus the types this mode can generate. */
interface StreakCategory {
  config: CategoryQuizConfig
  types: QuizQuestionType[]
}

/** One served question, kept next to the config its labels/answers resolve against. */
interface Round {
  config: CategoryQuizConfig
  question: QuizQuestion
}

interface Run {
  startedAt: number
  /** Frozen at the moment of the first wrong answer — the timer stops with it. */
  endedAt: number | null
  correctCount: number
  phase: "active" | "failed" | "results"
}

/** Text options carry no display string — resolve name/letter from the config molecules. */
function optionLabel(molecules: QuizMolecule[], option: QuizOption): string {
  const molecule = molecules.find((m) => m.id === option.moleculeId)
  if (!molecule) return option.key
  // Letters only — the three-letter code would be a giveaway hint in letter questions.
  return option.display === "letter" ? (molecule.oneLetter ?? option.key) : molecule.name
}

/** The answer revealed after a wrong open answer — mirrors the quiz page's reveal. */
function correctAnswerText(question: QuizQuestion, molecules: QuizMolecule[]): string {
  const target = molecules.find((molecule) => molecule.id === question.targetId)
  const open = question.openAnswer
  if (open?.kind === "letter") {
    return (target?.oneLetter ?? open.acceptedAnswers[0] ?? "").toUpperCase()
  }
  return target?.name ?? open?.acceptedAnswers[0] ?? ""
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      to={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] py-1 text-sm text-muted-foreground",
        "transition-colors duration-150 hover:text-foreground",
        FOCUS_RING_CLASS,
      )}
    >
      <ArrowLeft className="size-4" strokeWidth={1.75} />
      {label}
    </Link>
  )
}

function MicroLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

function PromptView({ prompt, grayscale }: { prompt: QuizPrompt; grayscale: boolean }) {
  if (prompt.kind === "structure" && prompt.smiles) {
    return (
      // Mistr draws structures colorlessly — atom color coding would give
      // away part of what the open answer is supposed to test. The arbitrary
      // variant grays only the svg, never the error fallback; a projection,
      // when the molecule carries one, is a plain svg and grays the same.
      // Like the quiz prompt, this is a single-molecule context, so `grow`
      // keeps large molecules at 1:1 bonds instead of an unreadable square.
      <StructureView
        smiles={prompt.smiles}
        projection={prompt.projection}
        orientationDeg={prompt.orientationDeg}
        size={220}
        grow
        title={quizStrings.promptStructureLabel}
        className={cn("mx-auto", grayscale && "[&_svg]:grayscale")}
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
  return <p className="text-2xl font-semibold tracking-tight">{prompt.text}</p>
}

interface OptionButtonProps {
  option: QuizOption
  molecules: QuizMolecule[]
  index: number
  answered: boolean
  isSelected: boolean
  grayscale: boolean
  onSelect: () => void
}

function OptionButton({
  option,
  molecules,
  index,
  answered,
  isSelected,
  grayscale,
  onSelect,
}: OptionButtonProps) {
  const stateClass = answered
    ? option.correct
      ? "border-accent bg-accent/5 text-accent"
      : isSelected
        ? "border-destructive bg-destructive/10 text-destructive"
        : "opacity-60"
    : "cursor-pointer hover:border-primary/50"

  return (
    <button
      type="button"
      disabled={answered}
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
            orientationDeg={option.orientationDeg}
            mirror={option.mirror}
            size={150}
            className={cn(grayscale && "[&_svg]:grayscale")}
          />
        </div>
      ) : (
        <span
          className={cn(
            option.display === "letter" ? "font-mono tabular text-lg" : "text-sm font-medium",
          )}
        >
          {optionLabel(molecules, option)}
        </span>
      )}
    </button>
  )
}

interface OpenAnswerFormProps {
  answered: boolean
  verdict: "correct" | "incorrect" | null
  onSubmit: (value: string) => void
}

/**
 * Mistr's answer slot, mirroring the quiz page's hard-mode form including
 * the Enter bugfix: the input owns the Enter that grades (`stopPropagation`),
 * so it can never double as the "continue" keystroke. Correct answers advance
 * without a verdict; after a wrong answer the input is locked (and disabled
 * inputs can't be focused), so a later Enter bubbles up to the page's "Enter
 * = Zobrazit výsledky" listener. Remounted per question (`key`), so the draft
 * starts empty.
 */
function OpenAnswerForm({ answered, verdict, onSubmit }: OpenAnswerFormProps) {
  const [value, setValue] = useState("")
  // An input the grader would see as empty isn't worth locking in.
  const canSubmit = !answered && normalizeQuizAnswer(value) !== ""

  return (
    <div className="flex items-center justify-center gap-3">
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !answered) {
            event.preventDefault()
            event.stopPropagation()
            if (canSubmit) onSubmit(value)
          }
        }}
        placeholder={quizStrings.answerPlaceholder}
        aria-label={quizStrings.answerPlaceholder}
        autoComplete="off"
        spellCheck={false}
        autoFocus
        disabled={answered}
        className={cn(
          "max-w-xs text-center",
          verdict === "correct" && "border-accent bg-accent/5 text-accent",
          verdict === "incorrect" && "border-destructive bg-destructive/10 text-destructive",
          // A locked-in answer should read as graded, not greyed out.
          verdict !== null && "font-medium disabled:opacity-100",
        )}
      />
      {!answered && (
        <Button onClick={() => onSubmit(value)} disabled={!canSubmit}>
          {quizStrings.checkAnswer}
        </Button>
      )}
    </div>
  )
}

/**
 * The Biomolekuly streak run: one endless question at a time, every question
 * drawing from a random category, ending outright on the first wrong answer.
 * Učeň plays the easy multiple-choice types, Mistr the hard open-answer ones.
 * Unlike the calculations streak there is no server-side session — the quiz
 * engine is pure and stateless, so the run lives entirely in this component;
 * only the final {correctCount, totalSeconds} pair is posted, best effort,
 * the moment the run fails. A reload loses the in-progress run, same
 * limitation the calculations streak has.
 */
export function BiomoleculesStreakPage({ kind }: { kind: BiomoleculeStreakKind }) {
  const mode: QuizMode = kind === "apprentice" ? "easy" : "hard"
  const master = kind === "master"
  const loaded = useBiomoleculeDataLoaded()
  const categories = useMoleculeCategories()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  // The endless pool: every category with at least one generatable type in
  // this mode, each with its config prebuilt so a question is one seeded
  // engine call away.
  const pool = useMemo<StreakCategory[]>(() => {
    const entries: StreakCategory[] = []
    for (const category of categories) {
      const config = getCategoryQuizConfig(
        category.slug,
        allMolecules.filter((molecule) => molecule.categorySlug === category.slug),
      )
      if (!config) continue
      const types = generatableQuizTypes(config.molecules, config.characteristics, mode)
      if (types.length > 0) entries.push({ config, types })
    }
    return entries
  }, [categories, allMolecules, mode])

  const [run, setRun] = useState<Run | null>(null)
  const [round, setRound] = useState<Round | null>(null)
  const [questionNumber, setQuestionNumber] = useState(1)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Synchronous double-grade guard: two clicks (or an Enter plus a click)
  // inside one React batch would both grade against the pre-grade state.
  const gradingRef = useRef(false)

  // Serve the next question: a crypto-seeded single-question session from a
  // random eligible category, so nothing about one question leaks into the next.
  const nextRound = useCallback((): Round | null => {
    if (pool.length === 0) return null
    const random = crypto.getRandomValues(new Uint32Array(2))
    const entry = pool[random[0] % pool.length]
    const [question] = generateQuizSession(entry.config.molecules, {
      types: entry.types,
      questionCount: 1,
      seed: random[1],
      characteristics: entry.config.characteristics,
      mode,
    })
    return question ? { config: entry.config, question } : null
  }, [pool, mode])

  const startRun = useCallback(() => {
    gradingRef.current = false
    setSelectedKey(null)
    setQuestionNumber(1)
    setRound(nextRound())
    const startedAt = Date.now()
    setNow(startedAt)
    setRun({ startedAt, endedAt: null, correctCount: 0, phase: "active" })
  }, [nextRound])

  // Kick off the first run as soon as the dataset is there to draw from.
  // Before that `pool` is empty, and after it `run` is set — so this fires
  // exactly once per page entry (restart is startRun called from the UI).
  useEffect(() => {
    if (loaded && run === null && pool.length > 0) startRun()
  }, [loaded, run, pool.length, startRun])

  // Correct answer: the counter ticks up and the next question appears
  // immediately — there is deliberately no per-question celebration.
  const advance = useCallback(() => {
    gradingRef.current = false
    setSelectedKey(null)
    setQuestionNumber((n) => n + 1)
    setRound(nextRound())
  }, [nextRound])

  const grade = (correct: boolean) => {
    const current = run
    if (current?.phase !== "active" || gradingRef.current) return
    gradingRef.current = true
    if (correct) {
      setRun({ ...current, correctCount: current.correctCount + 1 })
      advance()
      return
    }
    const endedAt = Date.now()
    const totalSeconds = Math.max(0, Math.round((endedAt - current.startedAt) / 1000))
    // Best effort: a lost score only costs a leaderboard entry, not the
    // results the student is looking at.
    biomoleculesApi
      .recordStreakResult({ kind, correctCount: current.correctCount, totalSeconds })
      .catch(() => {})
    setRun({ ...current, endedAt, phase: "failed" })
  }

  const selectOption = (key: string) => {
    if (!round || run?.phase !== "active") return
    const option = round.question.options.find((candidate) => candidate.key === key)
    if (!option) return
    if (!option.correct) setSelectedKey(key)
    grade(option.correct)
  }

  const submitOpenAnswer = (input: string) => {
    if (!round) return
    grade(isOpenAnswerCorrect(round.question, input))
  }

  const showResults = () => {
    setRun((current) =>
      current?.phase === "failed" ? { ...current, phase: "results" } : current,
    )
  }

  // The live timer: ticks once a second while the run is active, freezes the
  // moment it fails (`endedAt` takes over as the displayed end).
  const active = run?.phase === "active"
  useEffect(() => {
    if (!active) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [active])

  // Enter opens the results once the run has failed — the mistro input that
  // could have swallowed this keystroke is disabled by then.
  useEffect(() => {
    if (run?.phase !== "failed") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault()
        // Functional update keeps this listener free of extra dependencies.
        setRun((current) =>
          current?.phase === "failed" ? { ...current, phase: "results" } : current,
        )
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [run?.phase])

  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48 rounded-[4px]" />
        <Skeleton className="h-24 rounded-[4px]" />
      </div>
    )
  }

  // A store with nothing this mode can ask about (e.g. every category too
  // small for four-option questions — or, for Mistr, none with letter codes)
  // gets a friendly state instead of a run that can never serve a question.
  if (pool.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <BackLink href="/biomolekuly/test" label={streakStrings.resultsBackToModes} />
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="font-medium">{cs.biomolekuly.test.streakEmptyTitle}</p>
            <p className="text-sm text-muted-foreground">
              {cs.biomolekuly.test.streakEmptyDescription}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!run) {
    // The dataset is loaded and the start effect is about to fire — a single
    // frame at most; render nothing rather than flicker a skeleton again.
    return null
  }

  const failed = run.phase === "failed"
  const elapsedSeconds = Math.max(0, Math.floor(((run.endedAt ?? now) - run.startedAt) / 1000))

  if (run.phase === "results") {
    // Pace per attempted question, including the one that ended the run —
    // a 0-streak otherwise couldn't show a meaningful average.
    const secondsPerAnswer = elapsedSeconds / (run.correctCount + 1)
    return (
      <div className="space-y-6 max-w-lg">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {streakStrings.resultsTitle}
          </h1>
          <p className="text-muted-foreground text-sm">
            {master ? streakStrings.kindMaster : streakStrings.kindApprentice}
          </p>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
              <Trophy className="size-8 text-amber-500" />
              <p className="text-xl font-semibold">
                {streakStrings.resultsCorrectCount.replace("{count}", String(run.correctCount))}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {streakStrings.resultsTotalTime.replace("{time}", "")}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatMinutesSeconds(elapsedSeconds)}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {streakStrings.resultsTimePerAnswer.replace("{time}", "")}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatDecimalComma(secondsPerAnswer.toFixed(1))} s
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button onClick={startRun}>
            <RotateCcw className="size-4 mr-2" />
            {streakStrings.resultsTryAgain}
          </Button>
          <Button variant="outline" asChild>
            <Link to="/biomolekuly/test">
              <Target className="size-4 mr-2" />
              {streakStrings.resultsBackToModes}
            </Link>
          </Button>
        </div>
      </div>
    )
  }

  const question = round?.question
  if (!question || !round) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <BackLink href="/biomolekuly/test" label={streakStrings.resultsBackToModes} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {streakStrings.activeTitle}
          </h1>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {streakStrings.correctSoFar.replace("{count}", String(run.correctCount))}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1 justify-end">
            <Timer className="size-3" />
            {streakStrings.elapsedTime}
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {formatMinutesSeconds(elapsedSeconds)}
          </p>
        </div>
      </div>

      <div className="space-y-2 py-2 text-center">
        <MicroLabel>{quizStrings.types[question.type]}</MicroLabel>
        <PromptView prompt={question.prompt} grayscale={master} />
      </div>

      {master ? (
        <OpenAnswerForm
          key={questionNumber}
          answered={failed}
          verdict={failed ? "incorrect" : null}
          onSubmit={submitOpenAnswer}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {question.options.map((option, i) => (
            <OptionButton
              key={option.key}
              option={option}
              molecules={round.config.molecules}
              index={i}
              answered={failed}
              isSelected={option.key === selectedKey}
              grayscale={false}
              onSelect={() => selectOption(option.key)}
            />
          ))}
        </div>
      )}

      {failed && (
        <div className="flex items-center justify-between gap-4" aria-live="polite">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-destructive">
              {run.correctCount === 0
                ? streakStrings.failedMessageImmediate
                : streakStrings.failedMessage}
            </p>
            {master && (
              <p className="text-sm text-muted-foreground">
                {quizStrings.correctAnswerWas.replace(
                  "{answer}",
                  correctAnswerText(question, round.config.molecules),
                )}
              </p>
            )}
          </div>
          <Button onClick={showResults}>
            <Trophy className="size-4 mr-2" />
            {streakStrings.viewResults}
          </Button>
        </div>
      )}
    </div>
  )
}
