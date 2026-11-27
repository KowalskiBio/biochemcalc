import { ArrowLeft } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { RichText } from "@/components/ui/rich-text"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import type { BiomoleculeTestStudentView } from "@/lib/biomolecules-api"
import type {
  QuizMolecule,
  QuizOption,
  QuizQuestion,
} from "@/lib/molecules/quiz/question-generator"
import { generateTestSession, testQuestionPool } from "@/lib/molecules/test"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.biomolekuly.testy
const quizStrings = cs.biomolekuly.quiz

/** Review payload handed over by the run page (fresh submissions only). */
interface RunReview {
  questions: QuizQuestion[]
  verdicts: (boolean | undefined)[]
  selections: (string | null)[]
}

function optionLabel(
  molecules: QuizMolecule[],
  option: Pick<QuizOption, "display" | "moleculeId" | "key">,
): string {
  const molecule = molecules.find((m) => m.id === option.moleculeId)
  if (!molecule) return option.key
  return option.display === "letter" ? (molecule.oneLetter ?? option.key) : molecule.name
}

function PromptReview({
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
        size={160}
        monochrome={monochrome}
        title={quizStrings.promptStructureLabel}
        className="mx-auto"
      />
    )
  }
  if (prompt.kind === "letter") {
    return <p className="font-mono tabular text-3xl font-semibold tracking-tight">{prompt.text}</p>
  }
  if (prompt.kind === "characteristic") {
    return (
      <p className="text-lg font-semibold tracking-tight">
        {prompt.predicate ? quizStrings.characteristicPrompts[prompt.predicate] : prompt.text}
      </p>
    )
  }
  return (
    <p className="text-xl font-semibold tracking-tight">
      <RichText text={prompt.text} />
    </p>
  )
}

export function BiomoleculesTestResultPage() {
  const location = useLocation()
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  const state = location.state as {
    view?: BiomoleculeTestStudentView
    review?: RunReview
  } | null
  const view = state?.view ?? null
  const review = state?.review ?? null

  const test = view?.test ?? null
  const attempt = view?.attempt ?? null

  // Post-hub review: regenerate the batch from the attempt seed; the picks
  // the submission stored (detailJson `answers`, matched by uid) mark what
  // the student chose next to the correct options.
  let regenerated: QuizQuestion[] | null = null
  if (loaded && test !== null && review === null && attempt !== null) {
    regenerated = generateTestSession(test, attempt.seed, allMolecules)
  }

  if (!loaded || view === null || test === null || attempt === null) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <p className="text-sm text-destructive">{testyStrings.loadError}</p>
        <Button variant="outline" asChild>
          <Link to="/biomolekuly/test">{testyStrings.backToHub}</Link>
        </Button>
      </div>
    )
  }

  const total = attempt.totalCount ?? test.questionCount
  const correct = attempt.correctCount ?? 0
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100)
  let byType: Record<string, { correct: number; total: number }> = {}
  const storedAnswers = new Map<string, { correct: boolean; selectedKey: string | null }>()
  if (attempt.detailJson !== null) {
    try {
      const parsed = JSON.parse(attempt.detailJson) as {
        byType?: typeof byType
        answers?: unknown
      }
      byType = parsed.byType ?? {}
      if (Array.isArray(parsed.answers)) {
        for (const answer of parsed.answers as {
          uid?: unknown
          correct?: unknown
          selectedKey?: unknown
        }[]) {
          if (typeof answer?.uid !== "string") continue
          storedAnswers.set(answer.uid, {
            correct: answer.correct === true,
            selectedKey: typeof answer.selectedKey === "string" ? answer.selectedKey : null,
          })
        }
      }
    } catch {
      byType = {}
    }
  }

  // Review rows: fresh submissions carry the full payload; older ones show
  // the regenerated batch with the correct answers marked.
  const reviewRows: {
    question: QuizQuestion
    verdict: boolean | undefined
    selectedKey: string | null
  }[] =
    review !== null
      ? review.questions.map((question, index) => ({
          question,
          verdict: review.verdicts[index],
          selectedKey: review.selections[index] ?? null,
        }))
      : regenerated !== null
        ? regenerated.map((question) => {
            const stored = question.uid ? storedAnswers.get(question.uid) : undefined
            return {
              question,
              verdict: stored?.correct,
              selectedKey: stored?.selectedKey ?? null,
            }
          })
        : []

  const molecules: QuizMolecule[] = testQuestionPool(test, allMolecules)?.molecules ?? []

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          to="/biomolekuly/test"
          className="-my-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-[4px] py-2 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          {testyStrings.backToHub}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{testyStrings.resultTitle}</h1>
        <p className="text-sm text-muted-foreground">{test.title}</p>
      </div>

      <div className="py-2 text-center">
        <div className="font-mono tabular text-4xl font-semibold tracking-tight">
          {testyStrings.scoreLine
            .replace("{correct}", String(correct))
            .replace("{total}", String(total))}
        </div>
        <p className="mt-1 font-mono tabular text-sm text-muted-foreground">{percentage} %</p>
      </div>

      {Object.keys(byType).length > 0 ? (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {quizStrings.perTypeTitle}
          </p>
          <dl className="mt-2 divide-y divide-border rounded-[4px] border">
            {Object.entries(byType).map(([type, entry]) => (
              <div key={type} className="flex items-center justify-between px-3 py-2">
                <dt className="text-sm text-muted-foreground">
                  {quizStrings.types[type as keyof typeof quizStrings.types] ?? type}
                </dt>
                <dd className="font-mono tabular text-sm font-medium">
                  {entry.correct} / {entry.total}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{testyStrings.breakdownUnavailable}</p>
      )}

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{testyStrings.reviewTitle}</h2>
        {reviewRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {testyStrings.resultGenerationUnavailable}
          </p>
        ) : (
          <>
            {review === null && storedAnswers.size === 0 && (
              <p className="text-sm text-muted-foreground">{testyStrings.reviewWithoutChoices}</p>
            )}
            <ol className="space-y-4">
              {reviewRows.map((row, index) => (
                <li key={row.question.uid ?? index} className="rounded-[4px] border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {testyStrings.questionNumber.replace("{number}", String(index + 1))} ·{" "}
                      {quizStrings.types[row.question.type as keyof typeof quizStrings.types] ??
                        row.question.type}
                    </p>
                    {row.verdict !== undefined && (
                      <span
                        className={
                          row.verdict
                            ? "font-mono tabular text-xs font-semibold text-accent"
                            : "font-mono tabular text-xs font-semibold text-destructive"
                        }
                      >
                        {row.verdict ? quizStrings.correct : quizStrings.incorrect}
                      </span>
                    )}
                  </div>
                  <div className="mt-2">
                    <PromptReview prompt={row.question.prompt} monochrome={test.monochrome} />
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {row.question.options.map((option) => {
                      const picked = row.selectedKey === option.key
                      if (option.display === "structure") {
                        return (
                          <li key={option.key} className="flex items-center justify-center">
                            <div
                              className={`rounded-[4px] border p-2 ${
                                option.correct
                                  ? "border-accent"
                                  : picked
                                    ? "border-destructive"
                                    : "border-border opacity-60"
                              }`}
                            >
                              <StructureView
                                smiles={option.smiles ?? ""}
                                projection={option.projection}
                                haworth={option.haworth ?? true}
                                fischer={option.fischer ?? true}
                                orientationDeg={option.orientationDeg}
                                size={130}
                                monochrome={test.monochrome}
                              />
                            </div>
                          </li>
                        )
                      }
                      return (
                        <li
                          key={option.key}
                          className={`flex items-center gap-2 rounded-[4px] border px-3 py-1.5 text-sm ${
                            option.correct
                              ? "border-accent/60 bg-accent/5 text-accent"
                              : picked
                                ? "border-destructive/60 bg-destructive/5 text-destructive"
                                : "border-border text-muted-foreground"
                          }`}
                        >
                          <RichText text={optionLabel(molecules, option)} />
                          {(option.correct || picked) && (
                            <span className="ml-auto text-xs font-medium">
                              {[
                                picked ? cs.peptidovka.practice.yourAnswer : null,
                                option.correct ? testyStrings.correctOption : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  )
}
