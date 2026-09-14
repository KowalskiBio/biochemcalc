import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FormattedResult } from "@/components/ui/formatted-result"
import { UnitRenderer } from "@/components/ui/unit-renderer"
import { cs } from "@/i18n/cs"
import { resolveOptionsPrecision } from "@/lib/math-utils"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import type { TestReviewItem } from "@/lib/types"
import { cn } from "@/lib/utils"

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const

/**
 * One finished test question, read-only: the selected (or typed) answer
 * highlighted red if it was wrong, the actual correct option or value
 * highlighted green. A question the student skipped shows neither — the
 * server never reveals an unanswered attempt's correct answer, so there is
 * nothing here to highlight beyond "unanswered".
 */
export function QuestionReviewCard({ index, item }: { index: number; item: TestReviewItem }) {
  const { question, answer, result } = item
  const isClosed = question.mode === "closed"
  const optionRowCount = question.answerSlots[0]?.numericOptions?.length ?? 0
  const optionsPrecision = question.answerSlots.map((slot) =>
    resolveOptionsPrecision(slot.numericOptions ?? []),
  )
  const answered = isClosed
    ? answer.selectedOption != null
    : (answer.answers ?? []).some((v) => v.trim() !== "")

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <CardTitle className="text-base">
          {index + 1}. {cs.student.questionHeading}
        </CardTitle>
        <div className="flex items-center gap-2">
          {result && (
            <Badge
              variant={result.correct ? undefined : "destructive"}
              className={cn(
                result.correct &&
                  "border-transparent bg-green-600 text-white hover:bg-green-600/90",
              )}
            >
              {result.correct ? cs.test.reviewCorrect : cs.test.reviewIncorrect}
            </Badge>
          )}
          {!answered && <Badge variant="outline">{cs.test.reviewUnanswered}</Badge>}
          <Badge variant="outline">
            {cs.student.difficultyPoints.replace("{value}", String(question.pointValue))}
          </Badge>
        </div>
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
              const isTheAnswer =
                result?.correctOption === option || result?.alternateOption === option
              const gotItWrong = isSelected && result != null && !result.correct

              return (
                <div
                  key={label}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-left text-sm",
                    isSelected && !result && "border-primary bg-primary/10",
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
                </div>
              )
            })}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-3">
              {question.answerSlots.map((slot, slotIdx) => {
                const typed = answer.answers?.[slotIdx]?.trim()
                return (
                  <div
                    key={slot.symbol ?? slotIdx}
                    className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2 text-sm",
                      result &&
                        (result.correct
                          ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                          : "border-destructive bg-destructive/10"),
                    )}
                  >
                    <span>{typed || cs.test.reviewNoAnswer}</span>
                    {(slot.unit ?? question.resultUnit) && (
                      <UnitRenderer
                        unit={slot.unit ?? question.resultUnit}
                        className="text-muted-foreground"
                      />
                    )}
                  </div>
                )
              })}
            </div>
            {result && !result.correct && (
              <p className="text-sm text-muted-foreground">
                {result.correctAnswers.length > 1
                  ? cs.student.correctAnswersAre
                  : cs.student.correctAnswerIs}{" "}
                {result.correctAnswers.map((correctAnswer, idx) => (
                  <span key={correctAnswer.symbol ?? idx}>
                    {idx > 0 && "; "}
                    <FormattedResult
                      value={correctAnswer.value}
                      unit={correctAnswer.unit ?? question.resultUnit}
                      significantDigits={question.answerSlots[idx]?.significantDigits}
                      notation={question.forceScientific ? "scientific" : "normal"}
                    />
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
