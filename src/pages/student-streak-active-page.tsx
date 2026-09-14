import { Check, Loader2, RefreshCw, Timer, Trophy, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FormattedResult } from "@/components/ui/formatted-result"
import { Input } from "@/components/ui/input"
import { UnitRenderer } from "@/components/ui/unit-renderer"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { resolveOptionsPrecision } from "@/lib/math-utils"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import { studentApi } from "@/lib/student-api"
import type {
  PracticeAnswerResult,
  PracticeQuestion,
  StartStreakRunInput,
  StreakRunView,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * A streak run in progress: one question at a time, exactly like the
 * practice generator, except the run ends outright on the first wrong
 * answer — there is no "try again" once that happens, only a link to the
 * frozen results. The session is read from router state rather than a
 * fetchable id, same limitation the fixed-batch test flow already has: a
 * reload here loses the in-progress run.
 */
export function StudentStreakActivePage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { run?: StreakRunView; input?: StartStreakRunInput } | null
  const run = state?.run
  const startInput = state?.input

  const [question, setQuestion] = useState<PracticeQuestion | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [openAnswers, setOpenAnswers] = useState<string[]>([])
  const [result, setResult] = useState<PracticeAnswerResult | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [correctCount, setCorrectCount] = useState(0)
  const [failed, setFailed] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (failed) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [failed])

  const elapsedSeconds = useMemo(() => {
    if (!run) return 0
    return Math.max(0, Math.floor((now - new Date(run.startedAt).getTime()) / 1000))
  }, [run, now])

  const loadQuestion = useCallback(async () => {
    if (!run) return
    setIsGenerating(true)
    setResult(null)
    setSelectedOption(null)
    try {
      const next = await studentApi.nextStreakQuestion({ runId: run.runId })
      setQuestion(next)
      setOpenAnswers(next.answerSlots.map(() => ""))
    } catch (error) {
      setQuestion(null)
      toast({
        title: extractErrorMessage(error, cs.student.generationError),
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }, [run, toast])

  // biome-ignore lint/correctness/useExhaustiveDependencies: only on mount — subsequent questions are loaded explicitly.
  useEffect(() => {
    void loadQuestion()
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!question || result) return

    const isClosed = question.mode === "closed"
    if (isClosed && selectedOption === null) {
      toast({ title: cs.student.optionRequired, variant: "destructive" })
      return
    }

    let answers: number[] | undefined
    if (!isClosed) {
      const parsed = openAnswers.map((raw) => {
        const normalized = raw.trim().replace(",", ".")
        if (normalized.length === 0) return null
        const value = Number(normalized)
        return Number.isFinite(value) ? value : null
      })
      if (parsed.some((value) => value === null)) {
        toast({ title: cs.student.answerRequired, variant: "destructive" })
        return
      }
      answers = parsed as number[]
    }

    setIsSubmitting(true)
    try {
      const verdict = await studentApi.submitAnswer({
        attemptId: question.attemptId,
        selectedOption: isClosed ? (selectedOption ?? undefined) : undefined,
        answers,
      })
      setResult(verdict)
      if (verdict.correct) {
        setCorrectCount((prev) => prev + 1)
      } else {
        setFailed(true)
      }
    } catch (error) {
      toast({ title: extractErrorMessage(error, cs.student.submitError), variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }, [question, result, selectedOption, openAnswers, toast])

  if (!run) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.streak.activeTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{cs.streak.noActiveRun}</p>
          <Button onClick={() => navigate("/test")}>{cs.test.startTitle}</Button>
        </CardContent>
      </Card>
    )
  }

  const isClosed = question?.mode === "closed"
  const optionRowCount = question?.answerSlots[0]?.numericOptions?.length ?? 0
  const optionsPrecision =
    question?.answerSlots.map((slot) => resolveOptionsPrecision(slot.numericOptions ?? [])) ?? []

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.streak.activeTitle}
          </h1>
          <p className="text-muted-foreground text-sm">
            {cs.streak.correctSoFar.replace("{count}", String(correctCount))}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1 justify-end">
            <Timer className="size-3" />
            {cs.streak.elapsedTime}
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {formatMinutesSeconds(elapsedSeconds)}
          </p>
        </div>
      </div>

      {isGenerating && !question && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {cs.student.generating}
          </CardContent>
        </Card>
      )}

      {question && (
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-lg">{cs.student.questionHeading}</CardTitle>
              <CardDescription>
                {isClosed ? cs.student.closedHint : cs.student.openHint}
              </CardDescription>
            </div>
            <Badge variant="outline">
              {cs.student.difficultyPoints.replace("{value}", String(question.pointValue))}
            </Badge>
          </CardHeader>

          <CardContent className="space-y-6">
            <QuestionTextRenderer
              text={question.questionText}
              variables={question.variables}
              variant={{
                assignedValues: question.assignedValues,
                assignedStrings: question.assignedStrings,
              }}
              constants={question.constants}
            />

            {isClosed ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: optionRowCount }, (_, rowIdx) => {
                  const label = OPTION_LABELS[rowIdx] ?? String(rowIdx + 1)
                  const option = rowIdx + 1
                  const isSelected = selectedOption === option
                  const isTheAnswer =
                    result?.correctOption === option || result?.alternateOption === option
                  const gotItWrong = result != null && isSelected && !result.correct

                  return (
                    <button
                      key={label}
                      type="button"
                      disabled={result != null || isSubmitting}
                      onClick={() => setSelectedOption(option)}
                      className={cn(
                        "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                        !result && isSelected && "border-primary bg-primary/10",
                        !result && !isSelected && "hover:bg-muted/50",
                        isTheAnswer && "border-green-500 bg-green-50 dark:bg-green-950/30",
                        gotItWrong && "border-destructive bg-destructive/10",
                      )}
                    >
                      <span className="font-semibold">{label})</span>
                      <span>
                        {question.answerSlots.map((slot, slotIdx) => {
                          const value = slot.numericOptions?.[rowIdx]
                          if (value == null) return null
                          return (
                            <span key={slot.symbol ?? slotIdx}>
                              {slotIdx > 0 && ", "}
                              <FormattedResult
                                value={value}
                                unit={slot.unit ?? question.resultUnit}
                                precision={optionsPrecision[slotIdx]}
                                significantDigits={slot.significantDigits}
                                notation={question.forceScientific ? "scientific" : "normal"}
                              />
                            </span>
                          )
                        })}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {question.answerSlots.map((slot, slotIdx) => (
                  <div key={slot.symbol ?? slotIdx} className="flex items-center gap-2">
                    <Input
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder={cs.student.answerPlaceholder}
                      value={openAnswers[slotIdx] ?? ""}
                      disabled={result != null || isSubmitting}
                      className="w-28"
                      onChange={(e) =>
                        setOpenAnswers((prev) =>
                          prev.map((value, idx) => (idx === slotIdx ? e.target.value : value)),
                        )
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          if (result) {
                            if (!failed) void loadQuestion()
                          } else {
                            void handleSubmit()
                          }
                        }
                      }}
                    />
                    {(slot.unit ?? question.resultUnit) && (
                      <UnitRenderer
                        unit={slot.unit ?? question.resultUnit}
                        className="text-sm font-medium text-foreground"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            {result && (
              <div
                className={cn(
                  "rounded-md border px-4 py-3 space-y-1",
                  result.correct
                    ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                    : "border-destructive bg-destructive/10",
                )}
              >
                <p className="flex items-center gap-2 font-medium">
                  {result.correct ? (
                    <Check className="size-4 text-green-600 dark:text-green-400" />
                  ) : (
                    <X className="size-4 text-destructive" />
                  )}
                  {result.correct
                    ? cs.student.correct
                    : correctCount === 0
                      ? cs.streak.failedMessageImmediate
                      : cs.streak.failedMessage}
                </p>
                {!result.correct && (
                  <p className="text-sm text-muted-foreground">
                    {result.correctAnswers.length > 1
                      ? cs.student.correctAnswersAre
                      : cs.student.correctAnswerIs}{" "}
                    {result.correctAnswers.map((answer, idx) => (
                      <span key={answer.symbol ?? idx}>
                        {idx > 0 && "; "}
                        <FormattedResult
                          value={answer.value}
                          unit={answer.unit ?? question.resultUnit}
                          significantDigits={question.answerSlots[idx]?.significantDigits}
                          notation={question.forceScientific ? "scientific" : "normal"}
                        />
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {result ? (
                failed ? (
                  <Button
                    onClick={() =>
                      navigate("/test/streak/results", {
                        state: { runId: run.runId, input: startInput },
                      })
                    }
                  >
                    <Trophy className="size-4 mr-2" />
                    {cs.streak.viewResults}
                  </Button>
                ) : (
                  <Button onClick={loadQuestion} disabled={isGenerating}>
                    {isGenerating ? (
                      <Loader2 className="size-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4 mr-2" />
                    )}
                    {cs.student.nextQuestion}
                  </Button>
                )
              ) : (
                <Button onClick={handleSubmit} disabled={isSubmitting}>
                  {isSubmitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                  {isSubmitting ? cs.student.checking : cs.student.check}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
