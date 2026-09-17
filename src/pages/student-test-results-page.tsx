import { CheckCircle2, Loader2, Repeat, RotateCcw, Target } from "lucide-react"
import { useCallback, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { QuestionReviewCard } from "@/components/practice/question-review-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type { StartTestInput, TestResults, TestReviewItem } from "@/lib/types"

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * The score summary shown once a test session is finished. Reads `results`
 * from router state — reloading this page loses it (there is no fetchable
 * session id yet), so the "start another test" action is the only way back.
 * `input` (the exact settings the finished test was started with) travels
 * alongside it, letting "Znovu" relaunch the identical configuration without
 * sending the student back through the whole setup form.
 */
export function StudentTestResultsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as {
    results?: TestResults
    review?: TestReviewItem[]
    input?: StartTestInput
  } | null
  const results = state?.results
  const review = state?.review
  const input = state?.input
  /**
   * Both test kinds share this component, one route pair each. The kind
   * comes from the start input that travelled here; without it (a reload
   * that lost the router state) there is nothing to go back to but the mode
   * picker.
   */
  const backToStart = input ? `/test/${input.kind}` : "/test"

  const [isRetrying, setIsRetrying] = useState(false)

  const handleRetry = useCallback(async () => {
    if (!input || isRetrying) return
    setIsRetrying(true)
    try {
      const session = await studentApi.startTest(input)
      navigate(`${backToStart}/active`, { state: { session, input } })
    } catch (error) {
      toast({ title: extractErrorMessage(error, cs.test.tryAgainError), variant: "destructive" })
    } finally {
      setIsRetrying(false)
    }
  }, [input, isRetrying, backToStart, navigate, toast])

  if (!results) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.test.resultsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{cs.test.noActiveTest}</p>
          <Button onClick={() => navigate(backToStart)}>{cs.test.startAnother}</Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div className="max-w-lg space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.test.resultsTitle}
          </h1>
        </div>

        <Card>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="size-8 text-green-600 dark:text-green-400" />
              <div>
                <p className="text-xl font-semibold">
                  {cs.test.resultsScore
                    .replace("{correct}", String(results.correctCount))
                    .replace("{total}", String(results.totalQuestions))}
                </p>
                <p className="text-sm text-muted-foreground">
                  {cs.test.resultsAnswered
                    .replace("{count}", String(results.answeredCount))
                    .replace("{total}", String(results.totalQuestions))}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {cs.test.resultsPoints.replace("{points}", "")}
                </p>
                <p className="text-lg font-semibold tabular-nums">{results.points}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {cs.test.resultsTime.replace("{time}", "")}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatMinutesSeconds(results.elapsedSeconds)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          {input && (
            <Button onClick={handleRetry} disabled={isRetrying}>
              {isRetrying ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <RotateCcw className="size-4 mr-2" />
              )}
              {isRetrying ? cs.test.starting : cs.test.tryAgain}
            </Button>
          )}
          <Button variant="outline" onClick={() => navigate(backToStart)}>
            <Repeat className="size-4 mr-2" />
            {cs.test.startAnother}
          </Button>
          <Button variant="outline" onClick={() => navigate("/")}>
            <Target className="size-4 mr-2" />
            {cs.test.backToPractice}
          </Button>
        </div>
      </div>

      {review && review.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {cs.test.reviewTitle}
          </h2>
          <div className="space-y-4">
            {review.map((item, index) => (
              <QuestionReviewCard key={item.question.attemptId} index={index} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
