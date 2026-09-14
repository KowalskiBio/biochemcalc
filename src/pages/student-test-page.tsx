import { AlertTriangle, Loader2, Timer } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FormattedResult } from "@/components/ui/formatted-result"
import { Input } from "@/components/ui/input"
import { UnitRenderer } from "@/components/ui/unit-renderer"
import { useCountdown } from "@/hooks/use-countdown"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { resolveOptionsPrecision } from "@/lib/math-utils"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import { studentApi } from "@/lib/student-api"
import type {
  PracticeAnswerResult,
  PracticeQuestion,
  StartTestInput,
  TestAnswer,
  TestReviewItem,
  TestSessionView,
} from "@/lib/types"
import { cn } from "@/lib/utils"

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function QuestionCard({
  index,
  question,
  answer,
  onChange,
  disabled,
}: {
  index: number
  question: PracticeQuestion
  answer: TestAnswer
  onChange: (next: TestAnswer) => void
  disabled: boolean
}) {
  const isClosed = question.mode === "closed"
  const optionRowCount = question.answerSlots[0]?.numericOptions?.length ?? 0
  const optionsPrecision = question.answerSlots.map((slot) =>
    resolveOptionsPrecision(slot.numericOptions ?? []),
  )

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <CardTitle className="text-base">
          {index + 1}. {cs.student.questionHeading}
        </CardTitle>
        <Badge variant="outline">
          {cs.student.difficultyPoints.replace("{value}", String(question.pointValue))}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
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
              const isSelected = answer.selectedOption === option
              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  onClick={() => onChange({ selectedOption: option })}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors",
                    isSelected && "border-primary bg-primary/10",
                    !isSelected && "hover:bg-muted/50",
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
                  value={answer.answers?.[slotIdx] ?? ""}
                  disabled={disabled}
                  className="w-28"
                  onChange={(e) => {
                    const next = [...(answer.answers ?? question.answerSlots.map(() => ""))]
                    next[slotIdx] = e.target.value
                    onChange({ answers: next })
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
      </CardContent>
    </Card>
  )
}

/**
 * A fixed batch of questions generated all at once by `/test`, answered
 * together and graded only once submitted. The session is read from router
 * state rather than a fetchable id — there is no "resume" endpoint yet, so a
 * page reload here loses the in-progress test (the student must start over).
 */
export function StudentTestPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { session?: TestSessionView; input?: StartTestInput } | null
  const session = state?.session
  const startInput = state?.input

  const [answersByAttempt, setAnswersByAttempt] = useState<Record<string, TestAnswer>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const autoSubmitted = useRef(false)

  const deadlineMs = useMemo(() => {
    if (!session?.timeLimitSeconds) return undefined
    return new Date(session.startedAt).getTime() + session.timeLimitSeconds * 1000
  }, [session])

  const { remainingSeconds, expired } = useCountdown(deadlineMs)

  const answeredCount = session
    ? session.questions.filter((q) => {
        const a = answersByAttempt[q.attemptId]
        if (!a) return false
        return q.mode === "closed"
          ? a.selectedOption != null
          : (a.answers ?? []).every((v) => v.trim() !== "")
      }).length
    : 0

  const handleFinish = useCallback(async () => {
    if (!session || isSubmitting) return
    setIsSubmitting(true)
    try {
      // Grade every answered question, keeping each verdict so the results
      // page can show what was right/wrong per question rather than just the
      // aggregate score — a skipped question naturally stays ungraded (the
      // server only reveals its correct answer once one is submitted).
      const outcomes = await Promise.allSettled(
        session.questions.map(
          async (question): Promise<{ attemptId: string; result: PracticeAnswerResult } | null> => {
            const answer = answersByAttempt[question.attemptId]
            if (!answer) return null
            if (question.mode === "closed") {
              if (answer.selectedOption == null) return null
              const result = await studentApi.submitAnswer({
                attemptId: question.attemptId,
                selectedOption: answer.selectedOption,
              })
              return { attemptId: question.attemptId, result }
            }
            const parsed = (answer.answers ?? []).map((v) => Number(v.trim().replace(",", ".")))
            if (parsed.length === 0 || parsed.some((v) => !Number.isFinite(v))) {
              return null
            }
            const result = await studentApi.submitAnswer({
              attemptId: question.attemptId,
              answers: parsed,
            })
            return { attemptId: question.attemptId, result }
          },
        ),
      )

      const resultsByAttempt = new Map<string, PracticeAnswerResult>()
      for (const outcome of outcomes) {
        if (outcome.status === "fulfilled" && outcome.value) {
          resultsByAttempt.set(outcome.value.attemptId, outcome.value.result)
        }
      }

      const review: TestReviewItem[] = session.questions.map((question) => ({
        question,
        answer: answersByAttempt[question.attemptId] ?? {},
        result: resultsByAttempt.get(question.attemptId),
      }))

      const results = await studentApi.finishTest({ sessionId: session.sessionId })
      navigate("/test/cvicny/results", {
        state: { results, review, input: startInput },
        replace: true,
      })
    } catch (error) {
      toast({ title: extractErrorMessage(error, cs.test.finishError), variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }, [session, answersByAttempt, isSubmitting, startInput, navigate, toast])

  useEffect(() => {
    if (!expired || autoSubmitted.current || !session) return
    autoSubmitted.current = true
    toast({ title: cs.test.timeUpMessage })
    void handleFinish()
  }, [expired, session, handleFinish, toast])

  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.test.inProgressTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{cs.test.noActiveTest}</p>
          <Button onClick={() => navigate("/test/cvicny")}>{cs.test.startButton}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.test.inProgressTitle}
          </h1>
          <p className="text-muted-foreground text-sm">
            {cs.test.resultsAnswered
              .replace("{count}", String(answeredCount))
              .replace("{total}", String(session.questions.length))}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1 justify-end">
            <Timer className="size-3" />
            {cs.test.timeRemaining}
          </p>
          <p className="text-lg font-semibold tabular-nums">
            {remainingSeconds != null ? formatMinutesSeconds(remainingSeconds) : cs.test.untimed}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {session.questions.map((question, index) => (
          <QuestionCard
            key={question.attemptId}
            index={index}
            question={question}
            answer={answersByAttempt[question.attemptId] ?? {}}
            disabled={isSubmitting}
            onChange={(next) =>
              setAnswersByAttempt((prev) => ({ ...prev, [question.attemptId]: next }))
            }
          />
        ))}
      </div>

      <Button onClick={() => setShowConfirm(true)} disabled={isSubmitting} size="lg">
        {isSubmitting ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
        {isSubmitting ? cs.test.submitting : cs.test.submitButton}
      </Button>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" />
              {cs.test.submitConfirmTitle}
            </DialogTitle>
            <DialogDescription>
              {session.questions.length - answeredCount > 0
                ? cs.test.submitConfirmUnanswered.replace(
                    "{count}",
                    String(session.questions.length - answeredCount),
                  )
                : cs.test.submitConfirmAllAnswered}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirm(false)}>
              {cs.test.submitConfirmCancel}
            </Button>
            <Button
              onClick={() => {
                setShowConfirm(false)
                void handleFinish()
              }}
            >
              {cs.test.submitConfirmConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
