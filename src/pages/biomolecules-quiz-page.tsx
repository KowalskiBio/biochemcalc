import { ArrowLeft } from "lucide-react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { biomoleculesApi } from "@/lib/biomolecules-api"
import {
  type CategoryQuizConfig,
  createQuizSession,
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
  quizSessionReducer,
} from "@/lib/molecules/quiz"
import { cn } from "@/lib/utils"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useCategoryNames,
  useMoleculeCategories,
} from "@/stores/biomolecule-data-store"

const quizStrings = cs.biomolekuly.quiz

const EMPTY_QUESTIONS: QuizQuestion[] = []

type CountChoice = 10 | 20 | "all"
const COUNT_CHOICES: CountChoice[] = [10, 20, "all"]

const QUIZ_MODES: QuizMode[] = ["easy", "hard"]

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** One category's quiz material: its config plus the types each mode can generate. */
interface CategoryQuizEntry {
  config: CategoryQuizConfig
  easy: QuizQuestionType[]
  hard: QuizQuestionType[]
}

/** Text options carry no display string — resolve name/letter from the config molecules. */
function optionLabel(molecules: QuizMolecule[], option: QuizOption): string {
  const molecule = molecules.find((m) => m.id === option.moleculeId)
  if (!molecule) return option.key
  // Letters only — the three-letter code would be a giveaway hint in letter questions.
  return option.display === "letter" ? (molecule.oneLetter ?? option.key) : molecule.name
}

/**
 * The answer revealed after a wrong open answer: the target molecule's
 * display name, or its letter (uppercase) for letter answers. Falls back to
 * the engine's accepted answers when the molecule isn't at hand.
 */
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

interface OpenAnswerFormProps {
  answered: boolean
  verdict: "correct" | "incorrect" | null
  onSubmit: (value: string) => void
}

/**
 * Hard mode's answer slot: a text input instead of the option grid. Enter or
 * "Zkontrolovat" locks the answer; the input keeps showing the typed text and
 * takes the verdict tint. Remounted per question (`key={index}`), so the
 * draft starts empty. The typed answer itself lives only here — the session
 * records just the verdict (see QuestionScreen's `onOpenSubmit`).
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
          if (event.key === "Enter") {
            event.preventDefault()
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

interface SetupScreenProps {
  backHref: string
  backLabel: string
  categoryOptions: { slug: string; name: string }[]
  selectedCategory: string | null
  onSelectCategory: (slug: string) => void
  mode: QuizMode
  onModeChange: (mode: QuizMode) => void
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
  backLabel,
  categoryOptions,
  selectedCategory,
  onSelectCategory,
  mode,
  onModeChange,
  allTypes,
  allCount,
  selectedTypes,
  onToggleType,
  countChoice,
  onCountChoice,
  onStart,
}: SetupScreenProps) {
  // Reachable only in hard mode: the chosen category has types in easy mode
  // (otherwise it wouldn't be listed), but none survives the hard filter.
  const noTypesInMode = selectedCategory !== null && allTypes.length === 0
  const startDisabled = selectedCategory === null || selectedTypes.length === 0

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <BackLink href={backHref} label={backLabel} />

      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {quizStrings.title}
        </h1>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <MicroLabel>{quizStrings.categoryLabel}</MicroLabel>
        <Select value={selectedCategory ?? ""} onValueChange={onSelectCategory}>
          <SelectTrigger aria-label={quizStrings.categoryLabel} className="sm:w-80">
            <SelectValue placeholder={quizStrings.categoryPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((option) => (
              <SelectItem key={option.slug} value={option.slug}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Difficulty */}
      <div className="space-y-2">
        <MicroLabel>{quizStrings.modeLabel}</MicroLabel>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUIZ_MODES.map((candidate) => {
            const active = mode === candidate
            return (
              <button
                key={candidate}
                type="button"
                aria-pressed={active}
                onClick={() => onModeChange(candidate)}
                className={cn(
                  "flex min-h-[44px] cursor-pointer flex-col items-start justify-center gap-0.5 rounded-[4px] border px-3 py-2 text-left",
                  "transition-colors duration-150",
                  FOCUS_RING_CLASS,
                  active ? "border-primary bg-primary/10" : "bg-card hover:border-primary/50",
                )}
              >
                <span
                  className={cn("text-sm font-medium", active ? "text-primary" : "text-foreground")}
                >
                  {quizStrings.mode[candidate]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {candidate === "easy" ? quizStrings.modeEasyHint : quizStrings.modeHardHint}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {selectedCategory !== null && (
        <>
          {/* Question types */}
          <div className="space-y-2">
            <MicroLabel>{quizStrings.typesLabel}</MicroLabel>
            {noTypesInMode ? (
              <p className="text-sm text-muted-foreground">{quizStrings.noHardTypesHint}</p>
            ) : (
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
            )}
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
        </>
      )}

      <div className="space-y-2">
        <Button onClick={onStart} disabled={startDisabled}>
          {quizStrings.start}
        </Button>
        {selectedCategory !== null && !noTypesInMode && selectedTypes.length === 0 && (
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
  mode: QuizMode
  answered: boolean
  selectedKey: string | null
  onSelect: (key: string) => void
  onOpenSubmit: (input: string) => void
  onNext: () => void
}

function QuestionScreen({
  backHref,
  question,
  molecules,
  index,
  total,
  mode,
  answered,
  selectedKey,
  onSelect,
  onOpenSubmit,
  onNext,
}: QuestionScreenProps) {
  const progressText = quizStrings.questionOf
    .replace("{current}", String(index + 1))
    .replace("{total}", String(total))
  const progressPct = total > 0 ? ((index + (answered ? 1 : 0)) / total) * 100 : 0
  // Both modes land on an option key — easy mode's is the tapped option,
  // hard mode's is the verdict-mapped one — so one lookup grades any answer.
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

      {mode === "hard" ? (
        <OpenAnswerForm
          key={index}
          answered={answered}
          verdict={answered ? (wasCorrect ? "correct" : "incorrect") : null}
          onSubmit={onOpenSubmit}
        />
      ) : (
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
      )}

      {answered && (
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p
              className={cn("text-sm font-medium", wasCorrect ? "text-accent" : "text-destructive")}
            >
              {wasCorrect ? quizStrings.correct : quizStrings.incorrect}
            </p>
            {mode === "hard" && !wasCorrect && (
              <p className="text-sm text-muted-foreground">
                {quizStrings.correctAnswerWas.replace(
                  "{answer}",
                  correctAnswerText(question, molecules),
                )}
              </p>
            )}
          </div>
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
  mode: QuizMode
  onRestart: () => void
}

function ResultsScreen({ session, categoryId, mode, onRestart }: ResultsScreenProps) {
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
        <p className="mt-1 text-xs text-muted-foreground">
          {quizStrings.modeLabel}: {quizStrings.mode[mode]}
        </p>
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
  const params = useParams<{ categoryId: string }>()
  const paramSlug = params.categoryId ?? null
  const loaded = useBiomoleculeDataLoaded()
  const categories = useMoleculeCategories()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)
  const nameOf = useCategoryNames()

  // Each category's quiz material, used for the picker's eligibility filter
  // and (for the chosen category) the chips and sessions themselves.
  const quizByCategory = useMemo(() => {
    const map = new Map<string, CategoryQuizEntry>()
    for (const category of categories) {
      const config = getCategoryQuizConfig(
        category.slug,
        allMolecules.filter((molecule) => molecule.categorySlug === category.slug),
      )
      if (!config) continue
      map.set(category.slug, {
        config,
        easy: generatableQuizTypes(config.molecules, config.characteristics),
        hard: generatableQuizTypes(config.molecules, config.characteristics, "hard"),
      })
    }
    return map
  }, [categories, allMolecules])

  const [mode, setMode] = useState<QuizMode>("easy")
  const [slug, setSlug] = useState<string | null>(paramSlug)
  // null = "all of the above" — the chips start fully selected, but only
  // once the category+mode pair lands (before that allTypes is still empty).
  const [chosenTypes, setChosenTypes] = useState<QuizQuestionType[] | null>(null)
  const [countChoice, setCountChoice] = useState<CountChoice>(10)
  // The quiz in flight, bound to the setup it started from so mid-run setup
  // state can never skew a session's molecules, mode, or scoring category.
  const [activeQuiz, setActiveQuiz] = useState<{
    slug: string
    config: CategoryQuizConfig
    mode: QuizMode
  } | null>(null)
  const [session, dispatch] = useReducer(quizSessionReducer, EMPTY_QUESTIONS, createQuizSession)

  // Navigating between deep links (or off one) re-arms the setup
  // (adjust-state-during-render, so the stale selection never commits).
  const [prevParamSlug, setPrevParamSlug] = useState(paramSlug)
  if (prevParamSlug !== paramSlug) {
    setPrevParamSlug(paramSlug)
    setSlug(paramSlug)
    setChosenTypes(null)
    setActiveQuiz(null)
  }

  const entry = slug === null ? undefined : quizByCategory.get(slug)
  const allTypes = entry ? entry[mode] : []
  const selectedTypes = chosenTypes ?? allTypes

  const startQuiz = () => {
    if (slug === null || !entry || selectedTypes.length === 0) return
    const questionCount = countChoice === "all" ? entry.config.molecules.length : countChoice
    const questions = generateQuizSession(entry.config.molecules, {
      types: selectedTypes,
      questionCount,
      seed: Date.now(),
      characteristics: entry.config.characteristics,
      mode,
    })
    if (questions.length === 0) return
    dispatch({ type: "restart", questions })
    setActiveQuiz({ slug, config: entry.config, mode })
  }

  const toggleType = (type: QuizQuestionType) => {
    setChosenTypes(
      selectedTypes.includes(type)
        ? selectedTypes.filter((candidate) => candidate !== type)
        : [...selectedTypes, type],
    )
  }

  // Switching category or mode reshuffles the offered chips, so the
  // selection falls back to "all of the new list".
  const selectCategory = (next: string) => {
    if (next === slug) return
    setSlug(next)
    setChosenTypes(null)
  }
  const selectMode = (next: QuizMode) => {
    if (next === mode) return
    setMode(next)
    setChosenTypes(null)
  }

  // Report each finished session's score once, for the Biomolekuly
  // leaderboard. Keyed on the question array, which every (re)start replaces.
  const recordedQuestionsRef = useRef<QuizQuestion[] | null>(null)
  useEffect(() => {
    if (!activeQuiz || !session.finished || session.questions.length === 0) return
    if (recordedQuestionsRef.current === session.questions) return
    recordedQuestionsRef.current = session.questions
    const correct = session.answers.filter(Boolean).length
    // Best effort: a lost score only costs a leaderboard entry, not the
    // results screen the student is looking at.
    biomoleculesApi
      .recordQuizResult(activeQuiz.slug, correct, session.questions.length)
      .catch(() => {})
  }, [activeQuiz, session.finished, session.questions, session.answers])

  // Enter advances to the next question once the current one is answered.
  useEffect(() => {
    if (!activeQuiz || session.finished || !session.answered) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault()
        dispatch({ type: "next" })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeQuiz, session.finished, session.answered])

  // Wait for the first load before judging a slug — otherwise a direct
  // link would bounce to the hub while the dataset is still being fetched.
  if (!loaded) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48 rounded-[4px]" />
        <Skeleton className="h-24 rounded-[4px]" />
      </div>
    )
  }
  if (paramSlug !== null && !quizByCategory.has(paramSlug)) {
    return <Navigate to="/biomolekuly" replace />
  }

  // A category with nothing quiz-worthy (e.g. fewer than four molecules)
  // never shows the quiz button, but its URL can still be typed directly.
  if (
    !activeQuiz &&
    paramSlug !== null &&
    (quizByCategory.get(paramSlug)?.easy.length ?? 0) === 0
  ) {
    return <Navigate to={`/biomolekuly/${paramSlug}`} replace />
  }

  if (!activeQuiz) {
    // The picker lists categories that have at least one generatable type in
    // the chosen mode; a deep-linked preselection stays visible even when the
    // mode filter would hide it (the types section explains with a hint).
    const categoryOptions = categories
      .filter(
        (category) =>
          category.slug === slug || (quizByCategory.get(category.slug)?.[mode].length ?? 0) > 0,
      )
      .map((category) => ({ slug: category.slug, name: nameOf(category.slug) }))

    return (
      <SetupScreen
        backHref={slug === null ? "/biomolekuly" : `/biomolekuly/${slug}`}
        backLabel={slug === null ? cs.biomolekuly.backToCategories : quizStrings.backToCategory}
        categoryOptions={categoryOptions}
        selectedCategory={slug}
        onSelectCategory={selectCategory}
        mode={mode}
        onModeChange={selectMode}
        allTypes={allTypes}
        allCount={entry?.config.molecules.length ?? 0}
        selectedTypes={selectedTypes}
        onToggleType={toggleType}
        countChoice={countChoice}
        onCountChoice={setCountChoice}
        onStart={startQuiz}
      />
    )
  }

  if (session.finished) {
    return (
      <ResultsScreen
        session={session}
        categoryId={activeQuiz.slug}
        mode={activeQuiz.mode}
        onRestart={startQuiz}
      />
    )
  }

  const question = session.questions[session.index]
  if (!question) {
    return null
  }

  // Hard-mode answers are graded by the engine's open-answer matcher; the
  // verdict then goes through the reducer the only way it accepts — as the
  // matching option key (the correct one, or any distractor when wrong) — so
  // the recorded score, the breakdown, and the feedback line agree exactly.
  const submitOpenAnswer = (input: string) => {
    const correct = isOpenAnswerCorrect(question, input)
    const option = correct
      ? question.options.find((candidate) => candidate.correct)
      : question.options.find((candidate) => !candidate.correct)
    if (option) {
      dispatch({ type: "select", key: option.key })
    }
  }

  return (
    <QuestionScreen
      backHref={`/biomolekuly/${activeQuiz.slug}`}
      question={question}
      molecules={activeQuiz.config.molecules}
      index={session.index}
      total={session.questions.length}
      mode={activeQuiz.mode}
      answered={session.answered}
      selectedKey={session.selectedKey}
      onSelect={(key) => dispatch({ type: "select", key })}
      onOpenSubmit={submitOpenAnswer}
      onNext={() => dispatch({ type: "next" })}
    />
  )
}
