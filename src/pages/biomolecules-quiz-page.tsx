import { ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { biomoleculesApi } from "@/lib/biomolecules-api"
import {
  createQuizSession,
  generatableQuizTypes,
  generateQuizSession,
  getCategoryQuizConfig,
  type QuizMolecule,
  type QuizOption,
  type QuizPrompt,
  type QuizQuestion,
  type QuizQuestionType,
  quizSessionReducer,
} from "@/lib/molecules/quiz"
import { cn } from "@/lib/utils"
import {
  useBiomoleculeDataLoaded,
  useCategoryMolecules,
  useCategoryNames,
  useMoleculeCategory,
} from "@/stores/biomolecule-data-store"

const quizStrings = cs.biomolekuly.quiz

const EMPTY_QUESTIONS: QuizQuestion[] = []

type CountChoice = 10 | 20 | "all"
const COUNT_CHOICES: CountChoice[] = [10, 20, "all"]

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** Text options carry no display string — resolve name/letter from the config molecules. */
function optionLabel(molecules: QuizMolecule[], option: QuizOption): string {
  const molecule = molecules.find((m) => m.id === option.moleculeId)
  if (!molecule) return option.key
  // Letters only — the three-letter code would be a giveaway hint in letter questions.
  return option.display === "letter" ? (molecule.oneLetter ?? option.key) : molecule.name
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

function PromptView({ prompt }: { prompt: QuizPrompt }) {
  if (prompt.kind === "structure" && prompt.smiles) {
    return (
      <StructureView
        smiles={prompt.smiles}
        orientationDeg={prompt.orientationDeg}
        size={220}
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
  return <p className="text-2xl font-semibold tracking-tight">{prompt.text}</p>
}

interface OptionButtonProps {
  option: QuizOption
  molecules: QuizMolecule[]
  index: number
  answered: boolean
  isSelected: boolean
  onSelect: () => void
}

function OptionButton({
  option,
  molecules,
  index,
  answered,
  isSelected,
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
            orientationDeg={option.orientationDeg}
            mirror={option.mirror}
            size={150}
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

interface SetupScreenProps {
  backHref: string
  categoryName: string
  allTypes: QuizQuestionType[]
  allCount: number
  selectedTypes: QuizQuestionType[]
  onToggleType: (type: QuizQuestionType) => void
  countChoice: CountChoice
  onCountChoice: (choice: CountChoice) => void
  onStart: () => void
}

function SetupScreen({
  backHref,
  categoryName,
  allTypes,
  allCount,
  selectedTypes,
  onToggleType,
  countChoice,
  onCountChoice,
  onStart,
}: SetupScreenProps) {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <BackLink href={backHref} label={quizStrings.backToCategory} />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {quizStrings.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{categoryName}</p>
      </div>

      {/* Question types */}
      <div className="space-y-2">
        <MicroLabel>{quizStrings.typesLabel}</MicroLabel>
        <div className="flex flex-wrap gap-2">
          {allTypes.map((type) => {
            const active = selectedTypes.includes(type)
            return (
              <button
                key={type}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleType(type)}
                className={cn(
                  "min-h-[44px] cursor-pointer rounded-[4px] border px-3 text-sm font-medium",
                  "transition-colors duration-150",
                  FOCUS_RING_CLASS,
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
                )}
              >
                {quizStrings.types[type]}
              </button>
            )
          })}
        </div>
      </div>

      {/* Question count */}
      <div className="space-y-2">
        <MicroLabel>{quizStrings.countLabel}</MicroLabel>
        <div className="inline-flex">
          {COUNT_CHOICES.map((choice, i) => {
            const active = countChoice === choice
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={active}
                onClick={() => onCountChoice(choice)}
                className={cn(
                  "min-h-[44px] cursor-pointer border bg-card px-4 text-sm font-medium",
                  "transition-colors duration-150",
                  FOCUS_RING_CLASS,
                  i === 0 && "rounded-l-[4px]",
                  i === COUNT_CHOICES.length - 1 && "rounded-r-[4px]",
                  i > 0 && "-ml-px",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {choice === "all" ? (
                  <>
                    {quizStrings.countAll.split("{count}")[0]}
                    <span className="font-mono tabular">{allCount}</span>
                    {quizStrings.countAll.split("{count}")[1]}
                  </>
                ) : (
                  <span className="font-mono tabular">{choice}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <Button onClick={onStart} disabled={selectedTypes.length === 0}>
          {quizStrings.start}
        </Button>
        {selectedTypes.length === 0 && (
          <p className="text-sm text-muted-foreground">{quizStrings.noTypesHint}</p>
        )}
      </div>
    </div>
  )
}

interface QuestionScreenProps {
  backHref: string
  question: QuizQuestion
  molecules: QuizMolecule[]
  index: number
  total: number
  answered: boolean
  selectedKey: string | null
  onSelect: (key: string) => void
  onNext: () => void
}

function QuestionScreen({
  backHref,
  question,
  molecules,
  index,
  total,
  answered,
  selectedKey,
  onSelect,
  onNext,
}: QuestionScreenProps) {
  const progressText = quizStrings.questionOf
    .replace("{current}", String(index + 1))
    .replace("{total}", String(total))
  const progressPct = total > 0 ? ((index + (answered ? 1 : 0)) / total) * 100 : 0
  const selectedOption = question.options.find((o) => o.key === selectedKey)
  const wasCorrect = answered && selectedOption?.correct === true

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-center justify-between gap-4">
        <BackLink href={backHref} label={quizStrings.backToCategory} />
        <span className="whitespace-nowrap font-mono tabular text-sm text-muted-foreground">
          {progressText}
        </span>
      </div>
      <Progress value={progressPct} aria-label={progressText} className="h-1" />

      <div className="space-y-2 py-2 text-center">
        <MicroLabel>{quizStrings.types[question.type]}</MicroLabel>
        <PromptView prompt={question.prompt} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {question.options.map((option, i) => (
          <OptionButton
            key={option.key}
            option={option}
            molecules={molecules}
            index={i}
            answered={answered}
            isSelected={option.key === selectedKey}
            onSelect={() => onSelect(option.key)}
          />
        ))}
      </div>

      {answered && (
        <div className="flex items-center justify-between gap-4">
          <p className={cn("text-sm font-medium", wasCorrect ? "text-accent" : "text-destructive")}>
            {wasCorrect ? quizStrings.correct : quizStrings.incorrect}
          </p>
          <Button onClick={onNext}>{quizStrings.nextQuestion}</Button>
        </div>
      )}
    </div>
  )
}

interface ResultsScreenProps {
  session: {
    questions: QuizQuestion[]
    answers: boolean[]
  }
  categoryId: string
  onRestart: () => void
}

function ResultsScreen({ session, categoryId, onRestart }: ResultsScreenProps) {
  const total = session.questions.length
  const score = session.answers.filter(Boolean).length
  const percentage = total === 0 ? 0 : Math.round((score / total) * 100)

  const breakdown = new Map<QuizQuestionType, { correct: number; total: number }>()
  session.questions.forEach((question, i) => {
    const entry = breakdown.get(question.type) ?? { correct: 0, total: 0 }
    entry.total += 1
    if (session.answers[i]) entry.correct += 1
    breakdown.set(question.type, entry)
  })

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {quizStrings.resultsTitle}
        </h1>
      </div>

      <div className="py-4 text-center">
        <div className="font-mono tabular text-4xl font-semibold tracking-tight">
          {quizStrings.scoreLine
            .replace("{score}", String(score))
            .replace("{total}", String(total))}
        </div>
        <p className="mt-1 font-mono tabular text-sm text-muted-foreground">{percentage} %</p>
      </div>

      <div>
        <MicroLabel>{quizStrings.perTypeTitle}</MicroLabel>
        <dl className="mt-2 divide-y divide-border rounded-[4px] border">
          {Array.from(breakdown, ([type, entry]) => (
            <div key={type} className="flex items-center justify-between px-3 py-2">
              <dt className="text-sm text-muted-foreground">{quizStrings.types[type]}</dt>
              <dd className="font-mono tabular text-sm font-medium">
                {entry.correct} / {entry.total}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onRestart}>{quizStrings.tryAgain}</Button>
        <Button variant="outline" asChild>
          <Link to={`/biomolekuly/${categoryId}`}>{quizStrings.backToCategory}</Link>
        </Button>
      </div>
    </div>
  )
}

export function BiomoleculesQuizPage() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const slug = categoryId ?? ""
  const loaded = useBiomoleculeDataLoaded()
  const category = useMoleculeCategory(slug)
  const molecules = useCategoryMolecules(slug)
  const nameOf = useCategoryNames()
  const config = useMemo(() => getCategoryQuizConfig(slug, molecules), [slug, molecules])

  const allTypes = useMemo(
    () => (config ? generatableQuizTypes(config.molecules, config.characteristics) : []),
    [config],
  )
  // null = "all of the above" — the chips start fully selected, but only
  // once the dataset lands (before that allTypes is still empty).
  const [chosenTypes, setChosenTypes] = useState<QuizQuestionType[] | null>(null)
  const selectedTypes = chosenTypes ?? allTypes
  const [countChoice, setCountChoice] = useState<CountChoice>(10)
  const [started, setStarted] = useState(false)
  const [session, dispatch] = useReducer(quizSessionReducer, EMPTY_QUESTIONS, createQuizSession)

  // Reset the chips when navigating between categories within the route
  // (adjust-state-during-render, so the stale selection never commits).
  const [prevSlug, setPrevSlug] = useState(slug)
  if (prevSlug !== slug) {
    setPrevSlug(slug)
    setChosenTypes(null)
  }

  const startQuiz = () => {
    if (!config || selectedTypes.length === 0) return
    const questionCount = countChoice === "all" ? config.molecules.length : countChoice
    const questions = generateQuizSession(config.molecules, {
      types: selectedTypes,
      questionCount,
      seed: Date.now(),
      characteristics: config.characteristics,
    })
    dispatch({ type: "restart", questions })
    setStarted(true)
  }

  const toggleType = (type: QuizQuestionType) => {
    setChosenTypes(
      selectedTypes.includes(type)
        ? selectedTypes.filter((t) => t !== type)
        : [...selectedTypes, type],
    )
  }

  // Report each finished session's score once, for the Biomolekuly
  // leaderboard. Keyed on the question array, which every (re)start replaces.
  const recordedQuestionsRef = useRef<QuizQuestion[] | null>(null)
  useEffect(() => {
    if (!started || !session.finished || session.questions.length === 0 || !categoryId) return
    if (recordedQuestionsRef.current === session.questions) return
    recordedQuestionsRef.current = session.questions
    const correct = session.answers.filter(Boolean).length
    // Best effort: a lost score only costs a leaderboard entry, not the
    // results screen the student is looking at.
    biomoleculesApi.recordQuizResult(categoryId, correct, session.questions.length).catch(() => {})
  }, [started, session.finished, session.questions, session.answers, categoryId])

  // Enter advances to the next question once the current one is answered.
  useEffect(() => {
    if (!started || session.finished || !session.answered) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault()
        dispatch({ type: "next" })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [started, session.finished, session.answered])

  // Wait for the first load before judging a slug — otherwise a direct
  // link would bounce to the hub while the dataset is still being fetched.
  if (!category || !config) {
    if (!loaded) {
      return (
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Skeleton className="h-8 w-48 rounded-[4px]" />
          <Skeleton className="h-24 rounded-[4px]" />
        </div>
      )
    }
    return <Navigate to="/biomolekuly" replace />
  }

  // A category with nothing quiz-worthy (e.g. fewer than four molecules)
  // never shows the quiz button, but its URL can still be typed directly.
  if (!started && allTypes.length === 0) {
    return <Navigate to={`/biomolekuly/${category.slug}`} replace />
  }

  const backHref = `/biomolekuly/${category.slug}`
  const categoryName = nameOf(category.slug)

  if (!started) {
    return (
      <SetupScreen
        backHref={backHref}
        categoryName={categoryName}
        allTypes={allTypes}
        allCount={config.molecules.length}
        selectedTypes={selectedTypes}
        onToggleType={toggleType}
        countChoice={countChoice}
        onCountChoice={setCountChoice}
        onStart={startQuiz}
      />
    )
  }

  if (session.finished) {
    return <ResultsScreen session={session} categoryId={category.slug} onRestart={startQuiz} />
  }

  const question = session.questions[session.index]
  if (!question) {
    return null
  }

  return (
    <QuestionScreen
      backHref={backHref}
      question={question}
      molecules={config.molecules}
      index={session.index}
      total={session.questions.length}
      answered={session.answered}
      selectedKey={session.selectedKey}
      onSelect={(key) => dispatch({ type: "select", key })}
      onNext={() => dispatch({ type: "next" })}
    />
  )
}
