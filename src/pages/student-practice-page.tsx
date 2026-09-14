import { Check, Flag, Loader2, RefreshCw, Target, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ReportQuestionDialog } from "@/components/practice/report-question-dialog"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FormattedResult } from "@/components/ui/formatted-result"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
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
  PracticeTopic,
  TemplateMode,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const

/**
 * Accepts what a Czech student actually types: `1,5` as readily as `1.5`.
 * Returns `null` for anything that isn't a finite number so the caller can
 * refuse to submit rather than send a `NaN` the server would reject.
 */
function parseAnswer(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".")
  if (normalized.length === 0) return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/**
 * The student's practice generator: pick a topic and a difficulty, then
 * answer an endless stream of questions built from the teacher's own
 * templates with fresh values each time. Practice can be further narrowed to
 * one specific set (sada) rather than the whole difficulty. Open and closed
 * questions are mixed at random by default, or a student can restrict
 * practice to just one via the question-type selector. Every answer is
 * graded on the server (see `/api/student/submit-answer`) — the payload
 * behind a question deliberately contains no correct answer to peek at.
 */
export function StudentPracticePage() {
  const { toast } = useToast()

  const [topics, setTopics] = useState<PracticeTopic[]>([])
  const [isLoadingTopics, setIsLoadingTopics] = useState(true)
  const [topicId, setTopicId] = useState<string>("")
  const [pointValue, setPointValue] = useState<string>("")
  /** Empty string means "any set": drawn from all of them, the original behavior. */
  const [setId, setSetId] = useState<string>("")
  /** Empty string means "either": mixed at random, the original behavior. */
  const [modeFilter, setModeFilter] = useState<"" | TemplateMode>("")

  const [question, setQuestion] = useState<PracticeQuestion | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [selectedOption, setSelectedOption] = useState<number | null>(null)
  const [openAnswers, setOpenAnswers] = useState<string[]>([])
  const [result, setResult] = useState<PracticeAnswerResult | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [session, setSession] = useState({ correct: 0, total: 0 })
  const [isReportDialogOpen, setIsReportDialogOpen] = useState(false)

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === topicId) ?? null,
    [topics, topicId],
  )

  const selectedDifficulty = useMemo(
    () => selectedTopic?.difficulties.find((d) => String(d.pointValue) === pointValue) ?? null,
    [selectedTopic, pointValue],
  )

  /**
   * A specific set's mode is fixed by the teacher — never a separate random
   * choice like "any set" is. Once one is picked, the question-type filter
   * has nothing left to decide, so it must reflect (not contradict) that
   * set's actual mode rather than risk silently AND-ing against it and
   * producing a "no questions" error for a combination that was never a
   * real choice to begin with.
   */
  const selectedSet = useMemo(
    () => selectedDifficulty?.sets.find((s) => s.id === setId) ?? null,
    [selectedDifficulty, setId],
  )

  useEffect(() => {
    let cancelled = false
    studentApi
      .topics()
      .then((loaded) => {
        if (cancelled) return
        setTopics(loaded)
      })
      .catch((error) => {
        if (cancelled) return
        toast({
          title: extractErrorMessage(error, cs.student.generationError),
          variant: "destructive",
        })
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTopics(false)
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  // A difficulty only makes sense for the topic it was picked under: keep it
  // if the newly chosen topic also offers it, otherwise clear it rather than
  // leave a selection that would fail to generate.
  const handleTopicChange = useCallback(
    (nextTopicId: string) => {
      setTopicId(nextTopicId)
      const next = topics.find((t) => t.id === nextTopicId)
      const stillAvailable = next?.difficulties.some((d) => String(d.pointValue) === pointValue)
      if (!stillAvailable) {
        setPointValue("")
      }
      setSetId("")
      setQuestion(null)
      setResult(null)
    },
    [topics, pointValue],
  )

  const loadQuestion = useCallback(async () => {
    if (!topicId || !pointValue) return
    setIsGenerating(true)
    setResult(null)
    setSelectedOption(null)
    try {
      const next = await studentApi.nextQuestion({
        topicId,
        pointValue: Number(pointValue),
        // A specific set's mode is already fixed; only "any set" leaves the
        // question-type filter something to actually restrict.
        mode: setId ? undefined : modeFilter || undefined,
        setId: setId || undefined,
      })
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
  }, [topicId, pointValue, modeFilter, setId, toast])

  const handleSubmit = useCallback(async () => {
    if (!question || result) return

    const isClosed = question.mode === "closed"
    if (isClosed && selectedOption === null) {
      toast({ title: cs.student.optionRequired, variant: "destructive" })
      return
    }

    let answers: number[] | undefined
    if (!isClosed) {
      const parsed = openAnswers.map(parseAnswer)
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
      setSession((prev) => ({
        correct: prev.correct + (verdict.correct ? 1 : 0),
        total: prev.total + 1,
      }))
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.student.submitError),
        variant: "destructive",
      })
    } finally {
      setIsSubmitting(false)
    }
  }, [question, result, selectedOption, openAnswers, toast])

  if (isLoadingTopics) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32 mt-1" />
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (topics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.student.practiceTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{cs.student.noTopics}</CardContent>
      </Card>
    )
  }

  const isClosed = question?.mode === "closed"
  // Every answer slot of a closed question shares one correct position, so
  // the options line up row by row: row `i` is option a/b/c… across all the
  // quantities the question asks for at once.
  const optionRowCount = question?.answerSlots[0]?.numericOptions?.length ?? 0
  const optionsPrecision =
    question?.answerSlots.map((slot) => resolveOptionsPrecision(slot.numericOptions ?? [])) ?? []

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {cs.student.practiceTitle}
            </h1>
            <p className="text-muted-foreground text-sm">{cs.student.practiceDescription}</p>
          </div>
          {session.total > 0 && (
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                {cs.student.sessionScore}
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {cs.student.sessionScoreValue
                  .replace("{correct}", String(session.correct))
                  .replace("{total}", String(session.total))}
              </p>
            </div>
          )}
        </div>

        <Card>
          <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0 space-y-2">
              <Label htmlFor="practice-topic">{cs.student.topicLabel}</Label>
              <Select value={topicId} onValueChange={handleTopicChange}>
                <SelectTrigger id="practice-topic">
                  <SelectValue placeholder={cs.student.topicPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {topics.map((topic) => (
                    <SelectItem key={topic.id} value={topic.id}>
                      {topic.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="practice-difficulty">{cs.student.difficultyLabel}</Label>
              <Select
                value={pointValue}
                onValueChange={(value) => {
                  setPointValue(value)
                  setSetId("")
                  setQuestion(null)
                  setResult(null)
                }}
                disabled={!selectedTopic}
              >
                <SelectTrigger id="practice-difficulty">
                  <SelectValue placeholder={cs.student.difficultyPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {(selectedTopic?.difficulties ?? []).map((difficulty) => (
                    <SelectItem key={difficulty.pointValue} value={String(difficulty.pointValue)}>
                      {cs.student.difficultyPoints.replace(
                        "{value}",
                        String(difficulty.pointValue),
                      )}{" "}
                      ·{" "}
                      {cs.student.questionCount.replace(
                        "{count}",
                        String(difficulty.questionCount),
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="practice-set">{cs.student.setLabel}</Label>
              <Select
                value={setId || "any"}
                onValueChange={(value) => {
                  setSetId(value === "any" ? "" : value)
                  setQuestion(null)
                  setResult(null)
                }}
                disabled={!selectedDifficulty}
              >
                <SelectTrigger id="practice-set">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{cs.student.setAny}</SelectItem>
                  {(selectedDifficulty?.sets ?? []).map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      {set.name || cs.student.setIndex.replace("{index}", String(set.setIndex))}
                      {" · "}
                      {cs.student.questionCount.replace("{count}", String(set.questionCount))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor="practice-question-type">{cs.student.questionTypeLabel}</Label>
              <Select
                value={selectedSet ? selectedSet.mode : modeFilter || "either"}
                onValueChange={(value) => {
                  setModeFilter(value === "either" ? "" : (value as TemplateMode))
                  setQuestion(null)
                  setResult(null)
                }}
                disabled={!!selectedSet}
              >
                <SelectTrigger id="practice-question-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="either">{cs.student.questionTypeEither}</SelectItem>
                  <SelectItem value="closed">{cs.student.questionTypeClosed}</SelectItem>
                  <SelectItem value="open">{cs.student.questionTypeOpen}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={loadQuestion}
              disabled={!topicId || !pointValue || isGenerating}
              className="lg:mb-0"
            >
              {isGenerating ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Target className="size-4 mr-2" />
              )}
              {question ? cs.student.nextQuestion : cs.student.start}
            </Button>
          </CardContent>
        </Card>

        {isGenerating && !question && (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {cs.student.generating}
            </CardContent>
          </Card>
        )}

        {question && (
          <>
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="text-lg">{cs.student.questionHeading}</CardTitle>
                  <CardDescription>
                    {isClosed ? cs.student.closedHint : cs.student.openHint}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {cs.student.difficultyPoints.replace("{value}", String(question.pointValue))}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setIsReportDialogOpen(true)}
                    className="h-8 w-8"
                    title={cs.student.report}
                    aria-label={cs.student.report}
                  >
                    <Flag className="size-4" />
                  </Button>
                </div>
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
                                    significantDigits={
                                      slot.optionSigDigits?.[rowIdx] ?? slot.significantDigits
                                    }
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
                          id={`answer-${slotIdx}`}
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
                              void (result ? loadQuestion() : handleSubmit())
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
                      {result.correct ? cs.student.correct : cs.student.incorrect}
                      {result.correct && (
                        <span className="text-sm font-normal text-muted-foreground">
                          {cs.student.pointsEarned.replace("{points}", String(result.pointValue))}
                        </span>
                      )}
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
                    <Button onClick={loadQuestion} disabled={isGenerating}>
                      {isGenerating ? (
                        <Loader2 className="size-4 mr-2 animate-spin" />
                      ) : (
                        <RefreshCw className="size-4 mr-2" />
                      )}
                      {cs.student.nextQuestion}
                    </Button>
                  ) : (
                    <Button onClick={handleSubmit} disabled={isSubmitting}>
                      {isSubmitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
                      {isSubmitting ? cs.student.checking : cs.student.check}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
            <ReportQuestionDialog
              open={isReportDialogOpen}
              onOpenChange={setIsReportDialogOpen}
              attemptId={question.attemptId}
            />
          </>
        )}
      </div>

      <footer className="mt-10 pt-6 border-t border-border text-center text-[13px] text-muted-foreground space-y-1">
        <p>
          {cs.student.footerTeacher}:{" "}
          <strong className="text-foreground">Mgr. Vojtěch Sedláček, Ph.D.</strong>
          {" · "}
          <a href="mailto:21931@mail.muni.cz" className="text-primary hover:underline">
            21931@mail.muni.cz
          </a>
        </p>
        <p>
          {cs.student.footerAuthor} <strong className="text-foreground">Mgr. Vojtěch Rejtar</strong>
          {" · "}
          {cs.student.footerContact}:{" "}
          <a href="mailto:rejtarv@gmail.com" className="text-primary hover:underline">
            rejtarv@gmail.com
          </a>
          {" | "}
          <a href="mailto:rejtarv@sci.muni.cz" className="text-primary hover:underline">
            rejtarv@sci.muni.cz
          </a>
        </p>
        <p>{cs.student.footerBugs}</p>
        <p>
          <a
            href="https://github.com/KowalskiBio/biochemcalc/blob/main/LICENSE"
            className="text-primary hover:underline"
          >
            {cs.student.footerLicense}
          </a>
        </p>
      </footer>
    </div>
  )
}
