import { ArrowLeft, Flag } from "lucide-react"
import { useEffect, useMemo, useReducer, useRef, useState } from "react"
import { Link, Navigate, useParams } from "react-router-dom"

import { BiomoleculeReportQuestionDialog } from "@/components/biomolecules/report-question-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { RichText } from "@/components/ui/rich-text"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { biomoleculeReportsApi, snapshotOfQuestion } from "@/lib/biomolecule-reports-api"
import { biomoleculesApi } from "@/lib/biomolecules-api"
import {
  type CategoryQuizConfig,
  createQuizSession,
  generatableQuizTypes,
  generateQuizSession,
  getCategoryQuizConfig,
  getMergedQuizConfig,
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
import { stripRichMarkup } from "@/lib/rich-text"
import { cn } from "@/lib/utils"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useCategoryNames,
  useMoleculeCategories,
  useMoleculeTopics,
  useTopicText,
} from "@/stores/biomolecule-data-store"

const quizStrings = cs.biomolekuly.quiz

const EMPTY_QUESTIONS: QuizQuestion[] = []

const QUESTION_COUNT_MIN = 5
const QUESTION_COUNT_MAX = 50
const QUESTION_COUNT_DEFAULT = 10

const QUIZ_MODES: QuizMode[] = ["easy", "hard"]

/** Category-select sentinel for "every category in the chosen topic". */
const ALL_CATEGORIES_VALUE = "*"
/** Topic-select sentinel for the "Ostatní" (no topic) pseudo-topic. */
const NO_TOPIC_SELECT_VALUE = "__no_topic__"

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** One category's quiz material: its config plus the types each mode can generate. */
interface CategoryQuizEntry {
  config: CategoryQuizConfig
  easy: QuizQuestionType[]
  hard: QuizQuestionType[]
}

/** Derive the per-mode type lists for a config (single category or merged topic). */
function createQuizEntry(config: CategoryQuizConfig): CategoryQuizEntry {
  return {
    config,
    easy: generatableQuizTypes(config.molecules, config.characteristics),
    hard: generatableQuizTypes(config.molecules, config.characteristics, "hard"),
  }
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

/** What the free-text answer should look like, per question type. */
function answerInstruction(type: QuizQuestionType): string {
  return type === "nameToLetter" || type === "structureToLetter"
    ? quizStrings.instructionLetter
    : quizStrings.instructionName
}

/**
 * The question's task ("Struktura → Název") above the prompt. Full-size and
 * in its own casing, so the student can tell at a glance whether to answer
 * with the name or the abbreviation, which matters most when typing.
 */
function TaskLabel({ children }: { children: string }) {
  return <div className="text-base font-semibold text-foreground">{children}</div>
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
      // A parsed projection, when the target molecule carries one, takes
      // precedence over its SMILES inside StructureView. The prompt is a
      // single-molecule context: `grow` lets large molecules draw at 1:1
      // bonds instead of shrinking into the question's square.
      <StructureView
        smiles={prompt.smiles}
        projection={prompt.projection}
        haworth={prompt.haworth ?? true}
        fischer={prompt.fischer ?? true}
        orientationDeg={prompt.orientationDeg}
        size={220}
        grow
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
          {/* The same option carries smiles+orientationDeg as always;
              a projection, when present, wins inside StructureView. */}
          <StructureView
            smiles={option.smiles ?? ""}
            projection={option.projection}
            haworth={option.haworth ?? true}
            fischer={option.fischer ?? true}
            orientationDeg={option.orientationDeg}
            size={150}
          />
        </div>
      ) : (
        <span
          className={cn(
            option.display === "letter" ? "font-mono tabular text-lg" : "text-sm font-medium",
          )}
        >
          <RichText text={optionLabel(molecules, option)} />
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
 * "Zkontrolovat" locks the answer; the locked input keeps showing the typed
 * text and takes the same accent/destructive verdict state the easy-mode
 * option buttons use. The input owns its Enter keystroke (`stopPropagation`),
 * so grading never trips the window-level "Enter = next question" listener —
 * the first Enter reveals the verdict, the second advances. Remounted per
 * question (`key={index}`), so the draft starts empty. The typed answer
 * itself lives only here — the session records just the verdict (see
 * QuestionScreen's `onOpenSubmit`).
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
            // Keep this keystroke off window: the quiz's "Enter = next
            // question" listener must never see the Enter that graded this
            // answer — only the one pressed once the verdict is on screen.
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
          // A locked-in answer should read as graded, not greyed out — undo
          // the Input's disabled dimming once the verdict lands.
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

interface SetupScreenProps {
  backHref: string
  backLabel: string
  topicOptions: { value: string; label: string }[]
  selectedTopic: string
  onSelectTopic: (value: string) => void
  categoryOptions: { slug: string; name: string }[]
  selectedCategory: string | null
  onSelectCategory: (slug: string) => void
  mode: QuizMode
  onModeChange: (mode: QuizMode) => void
  allTypes: QuizQuestionType[]
  selectedTypes: QuizQuestionType[]
  onToggleType: (type: QuizQuestionType) => void
  questionCount: number
  onQuestionCountChange: (count: number) => void
  onStart: () => void
}

function SetupScreen({
  backHref,
  backLabel,
  topicOptions,
  selectedTopic,
  onSelectTopic,
  categoryOptions,
  selectedCategory,
  onSelectCategory,
  mode,
  onModeChange,
  allTypes,
  selectedTypes,
  onToggleType,
  questionCount,
  onQuestionCountChange,
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

      {/* Topic and category side by side; they stack on a phone */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <MicroLabel>{quizStrings.topicPickerLabel}</MicroLabel>
          <Select value={selectedTopic} onValueChange={onSelectTopic}>
            <SelectTrigger aria-label={quizStrings.topicPickerLabel}>
              <SelectValue placeholder={quizStrings.topicPickerLabel} />
            </SelectTrigger>
            <SelectContent>
              {topicOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="min-w-0 space-y-2">
          <MicroLabel>{quizStrings.categoryLabel}</MicroLabel>
          <Select value={selectedCategory ?? ""} onValueChange={onSelectCategory}>
            <SelectTrigger aria-label={quizStrings.categoryLabel}>
              <SelectValue placeholder={quizStrings.categoryPlaceholder} />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((option) => (
                <SelectItem key={option.slug} value={option.slug}>
                  <RichText text={option.name} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
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
            <div className="flex items-baseline gap-1.5">
              <MicroLabel>{quizStrings.countLabel}</MicroLabel>
              <span className="font-mono tabular text-sm font-semibold text-primary">
                {questionCount}
              </span>
            </div>
            <div className="max-w-xs space-y-0.5">
              <Slider
                value={[questionCount]}
                onValueChange={([value]) => onQuestionCountChange(value)}
                min={QUESTION_COUNT_MIN}
                max={QUESTION_COUNT_MAX}
                step={1}
                aria-label={quizStrings.countLabel}
              />
              <div
                aria-hidden="true"
                className="flex justify-between font-mono tabular text-[10px] text-muted-foreground"
              >
                <span>{QUESTION_COUNT_MIN}</span>
                <span>{QUESTION_COUNT_MAX}</span>
              </div>
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
  backLabel: string
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
  onReport: () => void
}

function QuestionScreen({
  backHref,
  backLabel,
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
  onReport,
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
        <BackLink href={backHref} label={backLabel} />
        <span className="whitespace-nowrap font-mono tabular text-sm text-muted-foreground">
          {progressText}
        </span>
      </div>
      <Progress value={progressPct} aria-label={progressText} className="h-1" />

      <div className="relative space-y-2 py-2 text-center">
        <Button
          variant="ghost"
          size="icon"
          onClick={onReport}
          className="absolute right-0 top-0 h-8 w-8"
          title={cs.student.report}
          aria-label={cs.student.report}
        >
          <Flag className="size-4" />
        </Button>
        <TaskLabel>{quizStrings.types[question.type]}</TaskLabel>
        <PromptView prompt={question.prompt} />
      </div>

      {mode === "hard" ? (
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            {answerInstruction(question.type)}
          </p>
          <OpenAnswerForm
            key={index}
            answered={answered}
            verdict={answered ? (wasCorrect ? "correct" : "incorrect") : null}
            onSubmit={onOpenSubmit}
          />
        </div>
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
        <div className="flex items-center justify-between gap-4" aria-live="polite">
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
                  stripRichMarkup(correctAnswerText(question, molecules)),
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
  backHref: string
  backLabel: string
  mode: QuizMode
  onRestart: () => void
}

function ResultsScreen({ session, backHref, backLabel, mode, onRestart }: ResultsScreenProps) {
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
          <Link to={backHref}>{backLabel}</Link>
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
  const topics = useMoleculeTopics()
  const { nameOf: topicNameOf } = useTopicText()

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
  // The topic step above the category picker. `null` is the "Ostatní"
  // pseudo-topic that collects categories without a (known) topic.
  const [topicSlug, setTopicSlug] = useState<string | null>(null)
  // null = "all of the above" — the chips start fully selected, but only
  // once the category+mode pair lands (before that allTypes is still empty).
  const [chosenTypes, setChosenTypes] = useState<QuizQuestionType[] | null>(null)
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNT_DEFAULT)
  // The quiz in flight, bound to the setup it started from so mid-run setup
  // state can never skew a session's molecules, mode, or scoring category.
  const [activeQuiz, setActiveQuiz] = useState<{
    slug: string
    scope: string
    config: CategoryQuizConfig
    mode: QuizMode
  } | null>(null)
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)
  const [session, dispatch] = useReducer(quizSessionReducer, EMPTY_QUESTIONS, createQuizSession)

  // Categories grouped exactly like the hub: a category pointing at a topic
  // that isn't in the payload falls into the "Ostatní" bucket.
  const knownTopicSlugs = new Set(topics.map((topic) => topic.slug))
  const categoriesByTopic = new Map<string, typeof categories>()
  for (const category of categories) {
    if (!category.topicSlug || !knownTopicSlugs.has(category.topicSlug)) continue
    const bucket = categoriesByTopic.get(category.topicSlug) ?? []
    bucket.push(category)
    categoriesByTopic.set(category.topicSlug, bucket)
  }
  const ungroupedCategories = categories.filter(
    (category) => !category.topicSlug || !knownTopicSlugs.has(category.topicSlug),
  )

  const topicCategories = (topic: string | null) =>
    topic === null ? ungroupedCategories : (categoriesByTopic.get(topic) ?? [])
  const hasTypesInMode = (categorySlug: string) =>
    (quizByCategory.get(categorySlug)?.[mode].length ?? 0) > 0
  const topicOfCategory = (categorySlug: string): string | null => {
    const category = categories.find((candidate) => candidate.slug === categorySlug)
    return category?.topicSlug && knownTopicSlugs.has(category.topicSlug)
      ? category.topicSlug
      : null
  }

  // The topic step only offers topics whose categories can quiz in the
  // current mode; the currently selected topic stays listed even when a mode
  // change would otherwise hide it. "Ostatní" sits at the end.
  const availableTopicSlugs = topics
    .filter((topic) =>
      (categoriesByTopic.get(topic.slug) ?? []).some((category) => hasTypesInMode(category.slug)),
    )
    .map((topic) => topic.slug)
  const hasUngroupedQuiz = ungroupedCategories.some((category) => hasTypesInMode(category.slug))
  const defaultTopicSlug = availableTopicSlugs[0] ?? null

  const [prevParamSlug, setPrevParamSlug] = useState(paramSlug)
  // A deep link arrives with its category's topic already selected; the plain
  // picker only preselects a topic (the category keeps its "choose one"
  // state until the student picks a category or changes the topic).
  // Adjusting during render keeps the stale (empty) selection from painting.
  const [topicReady, setTopicReady] = useState(false)
  if (loaded && !topicReady) {
    setTopicReady(true)
    setTopicSlug(paramSlug === null ? defaultTopicSlug : topicOfCategory(paramSlug))
    // A plain entry defaults to "všechny kategorie v tématu"; deep links keep
    // their linked category, matching the selection a same-topic switch
    // would leave behind. (Modes/topic changes already re-arm this way.)
    setSlug(paramSlug === null ? ALL_CATEGORIES_VALUE : paramSlug)
  }

  // Navigating between deep links (or off one) re-arms the setup
  // (adjust-state-during-render, so the stale selection never commits).
  if (prevParamSlug !== paramSlug) {
    setPrevParamSlug(paramSlug)
    setSlug(paramSlug === null ? ALL_CATEGORIES_VALUE : paramSlug)
    setTopicSlug(paramSlug === null ? defaultTopicSlug : topicOfCategory(paramSlug))
    setChosenTypes(null)
    setActiveQuiz(null)
  }

  // The topic-wide entry: each eligible category keeps its own adapter
  // output (letters, distractor classes), then the pool and its
  // characteristics are merged and re-qualified.
  const mergedEntry = (() => {
    if (slug !== ALL_CATEGORIES_VALUE) return undefined
    const sources = topicCategories(topicSlug).filter((category) => hasTypesInMode(category.slug))
    if (sources.length === 0) return undefined
    const config = getMergedQuizConfig(
      sources.map((category) => ({
        categoryId: category.slug,
        molecules: allMolecules.filter((molecule) => molecule.categorySlug === category.slug),
      })),
    )
    return config ? createQuizEntry(config) : undefined
  })()

  const entry =
    slug === null
      ? undefined
      : slug === ALL_CATEGORIES_VALUE
        ? mergedEntry
        : quizByCategory.get(slug)
  const allTypes = entry ? entry[mode] : []
  const selectedTypes = chosenTypes ?? allTypes

  const startQuiz = () => {
    if (slug === null || !entry || selectedTypes.length === 0) return
    const seed = Date.now()
    const questions = generateQuizSession(entry.config.molecules, {
      types: selectedTypes,
      questionCount,
      seed,
      characteristics: entry.config.characteristics,
      mode,
    }).map((question, index) => ({ ...question, uid: `${seed}-${index}` }))
    if (questions.length === 0) return
    setIsReportDialogOpen(false)
    dispatch({ type: "restart", questions })
    setActiveQuiz({
      slug,
      // Topic-wide runs score under the topic slug ("*" when the pool spans
      // ungrouped categories); category runs under their own slug. Every run
      // counts in the overall leaderboard.
      scope: slug === ALL_CATEGORIES_VALUE ? (topicSlug ?? "*") : slug,
      config: entry.config,
      mode,
    })
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
  // Changing the topic re-arms the category step on the topic-wide run; the
  // topic's own categories stay one click away below it.
  const selectTopic = (value: string) => {
    const next = value === NO_TOPIC_SELECT_VALUE ? null : value
    if (next === topicSlug) return
    setTopicSlug(next)
    setSlug(ALL_CATEGORIES_VALUE)
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
      .recordQuizResult({
        categoryId: activeQuiz.scope,
        correctCount: correct,
        totalCount: session.questions.length,
        mode: activeQuiz.mode,
      })
      .catch(() => {})
  }, [activeQuiz, session.finished, session.questions, session.answers])

  // Enter advances to the next question once the current one is answered. The
  // hard-mode input swallows its own Enter (see OpenAnswerForm), so this only
  // ever fires for the keystroke pressed after the verdict is already visible.
  useEffect(() => {
    if (!activeQuiz || session.finished || !session.answered || isReportDialogOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault()
        dispatch({ type: "next" })
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [activeQuiz, session.finished, session.answered, isReportDialogOpen])

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
    // The topic step lists topics with quiz material in the active mode (the
    // selected one stays put across a mode switch). The category step lists
    // that topic's eligible categories, "all of them" first; a deep-linked
    // preselection stays visible even when the mode filter would hide it.
    const topicOptions = topics
      .filter((topic) => availableTopicSlugs.includes(topic.slug) || topic.slug === topicSlug)
      .map((topic) => ({ value: topic.slug, label: topicNameOf(topic.slug) }))
    if (hasUngroupedQuiz || topicSlug === null) {
      topicOptions.push({ value: NO_TOPIC_SELECT_VALUE, label: cs.biomolekuly.noTopic })
    }

    const categoryOptions = [
      { slug: ALL_CATEGORIES_VALUE, name: quizStrings.allCategoriesInTopic },
      ...topicCategories(topicSlug)
        .filter((category) => category.slug === slug || hasTypesInMode(category.slug))
        .map((category) => ({ slug: category.slug, name: nameOf(category.slug) })),
    ]

    const backHref =
      slug === null || slug === ALL_CATEGORIES_VALUE ? "/biomolekuly" : `/biomolekuly/${slug}`
    const backLabel =
      slug === null || slug === ALL_CATEGORIES_VALUE
        ? cs.biomolekuly.backToCategories
        : quizStrings.backToCategory

    return (
      <SetupScreen
        backHref={backHref}
        backLabel={backLabel}
        topicOptions={topicOptions}
        selectedTopic={topicSlug ?? NO_TOPIC_SELECT_VALUE}
        onSelectTopic={selectTopic}
        categoryOptions={categoryOptions}
        selectedCategory={slug}
        onSelectCategory={selectCategory}
        mode={mode}
        onModeChange={selectMode}
        allTypes={allTypes}
        selectedTypes={selectedTypes}
        onToggleType={toggleType}
        questionCount={questionCount}
        onQuestionCountChange={setQuestionCount}
        onStart={startQuiz}
      />
    )
  }

  // A topic-wide run has no category page to return to; it ran on the plain
  // picker URL, so the hub is used instead — navigating to the current route
  // would look like a dead link.
  const runBackHref =
    activeQuiz.slug === ALL_CATEGORIES_VALUE ? "/biomolekuly" : `/biomolekuly/${activeQuiz.slug}`
  const runBackLabel =
    activeQuiz.slug === ALL_CATEGORIES_VALUE
      ? cs.biomolekuly.backToCategories
      : quizStrings.backToCategory

  if (session.finished) {
    return (
      <ResultsScreen
        session={session}
        backHref={runBackHref}
        backLabel={runBackLabel}
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

  // The dialog collects only the message; this callback freezes the snapshot
  // of the question on screen and posts it, letting backend errors (including
  // duplicate reports) surface through the dialog's toast.
  const reportQuestion = async (message: string) => {
    if (!question.uid) {
      throw new Error(cs.student.reportError)
    }
    await biomoleculeReportsApi.reportQuestion({
      questionUid: question.uid,
      scopeSlug: activeQuiz.scope,
      message,
      snapshot: snapshotOfQuestion(question, {
        scopeSlug: activeQuiz.scope,
        molecules: activeQuiz.config.molecules,
        answeredCorrect: session.answered ? (session.answers[session.index] ?? null) : null,
      }),
    })
  }

  return (
    <>
      <QuestionScreen
        backHref={runBackHref}
        backLabel={runBackLabel}
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
        onReport={() => setIsReportDialogOpen(true)}
      />
      <BiomoleculeReportQuestionDialog
        open={isReportDialogOpen}
        onOpenChange={setIsReportDialogOpen}
        onSubmit={reportQuestion}
      />
    </>
  )
}
