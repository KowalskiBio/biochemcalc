import { Loader2, Timer } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type { PracticeTopic, StartTestInput, TemplateMode } from "@/lib/types"

const DEFAULT_TIME_LIMIT_MINUTES = 20

/**
 * Where a student configures and launches a fixed-batch test session: every
 * question in a topic/point value (optionally narrowed to one set and/or
 * question type, same filters as the practice generator) at once, always
 * timed. The generated session is handed to `/test/active` via router state
 * rather than a refetchable id — there is deliberately no "resume a session"
 * endpoint yet, so reloading the in-progress or results page loses it.
 */
export function StudentTestStartPage() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [topics, setTopics] = useState<PracticeTopic[]>([])
  const [isLoadingTopics, setIsLoadingTopics] = useState(true)
  const [topicId, setTopicId] = useState<string>("")
  const [pointValue, setPointValue] = useState<string>("")
  /** Empty string means "any set": drawn from all of them. */
  const [setId, setSetId] = useState<string>("")
  /** Empty string means "either": mixed at random. */
  const [modeFilter, setModeFilter] = useState<"" | TemplateMode>("")
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(String(DEFAULT_TIME_LIMIT_MINUTES))
  const [isStarting, setIsStarting] = useState(false)

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === topicId) ?? null,
    [topics, topicId],
  )

  const selectedDifficulty = useMemo(
    () => selectedTopic?.difficulties.find((d) => String(d.pointValue) === pointValue) ?? null,
    [selectedTopic, pointValue],
  )

  /** A specific set's mode is fixed by the teacher; see the same guard on the practice page. */
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

  const handleTopicChange = useCallback(
    (nextTopicId: string) => {
      setTopicId(nextTopicId)
      const next = topics.find((t) => t.id === nextTopicId)
      const stillAvailable = next?.difficulties.some((d) => String(d.pointValue) === pointValue)
      if (!stillAvailable) setPointValue("")
      setSetId("")
    },
    [topics, pointValue],
  )

  const handleStart = useCallback(async () => {
    if (!topicId || !pointValue) return
    const minutes = Number(timeLimitMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) {
      toast({ title: cs.test.startError, variant: "destructive" })
      return
    }

    setIsStarting(true)
    try {
      const input: StartTestInput = {
        topicId,
        pointValue: Number(pointValue),
        timeLimitSeconds: Math.round(minutes * 60),
        // A specific set's mode is already fixed; only "any set" leaves the
        // question-type filter something to actually restrict.
        mode: setId ? undefined : modeFilter || undefined,
        setId: setId || undefined,
      }
      const session = await studentApi.startTest(input)
      // `input` travels alongside the session so the results page can offer
      // an instant "Znovu" that repeats this exact configuration, rather
      // than sending the student back through the whole setup form.
      navigate("/test/cvicny/active", { state: { session, input } })
    } catch (error) {
      toast({ title: extractErrorMessage(error, cs.test.startError), variant: "destructive" })
    } finally {
      setIsStarting(false)
    }
  }, [topicId, pointValue, setId, modeFilter, timeLimitMinutes, navigate, toast])

  if (isLoadingTopics) {
    return (
      <div className="space-y-6">
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

  if (topics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{cs.test.startTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{cs.student.noTopics}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.test.startTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.test.startDescription}</p>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_140px_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="test-topic">{cs.student.topicLabel}</Label>
            <Select value={topicId} onValueChange={handleTopicChange}>
              <SelectTrigger id="test-topic">
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

          <div className="space-y-2">
            <Label htmlFor="test-difficulty">{cs.student.difficultyLabel}</Label>
            <Select
              value={pointValue}
              onValueChange={(value) => {
                setPointValue(value)
                setSetId("")
              }}
              disabled={!selectedTopic}
            >
              <SelectTrigger id="test-difficulty">
                <SelectValue placeholder={cs.student.difficultyPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {(selectedTopic?.difficulties ?? []).map((difficulty) => (
                  <SelectItem key={difficulty.pointValue} value={String(difficulty.pointValue)}>
                    {cs.student.difficultyPoints.replace("{value}", String(difficulty.pointValue))}
                    {" · "}
                    {cs.student.questionCount.replace("{count}", String(difficulty.questionCount))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-set">{cs.student.setLabel}</Label>
            <Select
              value={setId || "any"}
              onValueChange={(value) => setSetId(value === "any" ? "" : value)}
              disabled={!selectedDifficulty}
            >
              <SelectTrigger id="test-set">
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

          <div className="space-y-2">
            <Label htmlFor="test-question-type">{cs.student.questionTypeLabel}</Label>
            <Select
              value={selectedSet ? selectedSet.mode : modeFilter || "either"}
              onValueChange={(value) =>
                setModeFilter(value === "either" ? "" : (value as TemplateMode))
              }
              disabled={!!selectedSet}
            >
              <SelectTrigger id="test-question-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="either">{cs.student.questionTypeEither}</SelectItem>
                <SelectItem value="closed">{cs.student.questionTypeClosed}</SelectItem>
                <SelectItem value="open">{cs.student.questionTypeOpen}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="test-time-limit">{cs.test.timeLimitLabel}</Label>
            <Input
              id="test-time-limit"
              type="number"
              inputMode="numeric"
              min={1}
              value={timeLimitMinutes}
              onChange={(e) => setTimeLimitMinutes(e.target.value)}
            />
          </div>

          <Button
            onClick={handleStart}
            disabled={!topicId || !pointValue || isStarting}
            className="lg:mb-0"
          >
            {isStarting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Timer className="size-4 mr-2" />
            )}
            {isStarting ? cs.test.starting : cs.test.startButton}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
