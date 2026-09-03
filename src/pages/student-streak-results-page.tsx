import { Loader2, RotateCcw, Target, Trophy } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type { StartStreakRunInput, StreakRunSummary } from "@/lib/types"

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * The frozen score of a streak run once it has failed: how many questions
 * were answered correctly in a row, the total time, and the average time
 * per answer. Read from `runId` in router state — reloading this page loses
 * that id, same "no resume" limitation the fixed-batch test results page has.
 * `input` (the exact settings this run was started with) travels alongside
 * it, letting "Znovu" relaunch the identical configuration instantly rather
 * than sending the student back through the setup form.
 */
export function StudentStreakResultsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { runId?: string; input?: StartStreakRunInput } | null
  const runId = state?.runId
  const input = state?.input

  const [summary, setSummary] = useState<StreakRunSummary | null>(null)
  const [isLoading, setIsLoading] = useState(!!runId)
  const [error, setError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    if (!runId) return
    let cancelled = false
    studentApi
      .streakRunSummary({ runId })
      .then((loaded) => {
        if (!cancelled) setSummary(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, cs.streak.noResults))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [runId])

  const handleRetry = useCallback(async () => {
    if (!input || isRetrying) return
    setIsRetrying(true)
    try {
      const run = await studentApi.startStreakRun(input)
      navigate("/test/streak/active", { state: { run, input } })
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.streak.setupStartError),
        variant: "destructive",
      })
    } finally {
      setIsRetrying(false)
    }
  }, [input, isRetrying, navigate, toast])

  if (!runId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.streak.resultsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">{cs.streak.noResults}</p>
          <Button onClick={() => navigate("/test")}>{cs.test.startTitle}</Button>
        </CardContent>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-lg">
        <Skeleton className="h-8 w-48" />
        <Card>
          <CardContent className="space-y-4 pt-6">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !summary) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.streak.resultsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-destructive">{error ?? cs.streak.noResults}</p>
          <Button onClick={() => navigate("/test")}>{cs.test.startTitle}</Button>
        </CardContent>
      </Card>
    )
  }

  const kindTitle = summary.kind === "apprentice" ? cs.streak.kindApprentice : cs.streak.kindMaster

  return (
    <div className="space-y-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.streak.resultsTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{kindTitle}</p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center gap-3">
            <Trophy className="size-8 text-amber-500" />
            <p className="text-xl font-semibold">
              {cs.streak.resultsCorrectCount.replace("{count}", String(summary.correctCount))}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-2 border-t">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {cs.streak.resultsTotalTime.replace("{time}", "")}
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {formatMinutesSeconds(summary.totalSeconds)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {cs.streak.resultsTimePerAnswer.replace("{time}", "")}
              </p>
              <p className="text-lg font-semibold tabular-nums">
                {summary.secondsPerAnswer.toFixed(1)} s
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
            {isRetrying ? cs.streak.setupStarting : cs.streak.resultsTryAgain}
          </Button>
        )}
        <Button variant="outline" onClick={() => navigate("/test")}>
          <Target className="size-4 mr-2" />
          {cs.streak.resultsBackToModes}
        </Button>
      </div>
    </div>
  )
}
