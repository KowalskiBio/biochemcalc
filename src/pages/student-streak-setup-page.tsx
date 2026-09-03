import { Loader2, Swords } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import type { PracticeTopic, StartStreakRunInput, StreakRunKind, TemplateMode } from "@/lib/types"

/**
 * Where a student configures and launches a streak run. "Apprentice" offers
 * the same topic/difficulty/set/question-type filters as the practice
 * generator (including the same set-locks-mode guard); "master" has nothing
 * to configure — it always draws from every topic — so it renders a plain
 * description and a start button.
 */
export function StudentStreakSetupPage({ kind }: { kind: StreakRunKind }) {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [topics, setTopics] = useState<PracticeTopic[]>([])
  const [isLoadingTopics, setIsLoadingTopics] = useState(kind === "apprentice")
  const [topicId, setTopicId] = useState<string>("")
  const [pointValue, setPointValue] = useState<string>("")
  const [setId, setSetId] = useState<string>("")
  const [modeFilter, setModeFilter] = useState<"" | TemplateMode>("")
  const [isStarting, setIsStarting] = useState(false)

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === topicId) ?? null,
    [topics, topicId],
  )
  const selectedDifficulty = useMemo(
    () => selectedTopic?.difficulties.find((d) => String(d.pointValue) === pointValue) ?? null,
    [selectedTopic, pointValue],
  )
  const selectedSet = useMemo(
    () => selectedDifficulty?.sets.find((s) => s.id === setId) ?? null,
    [selectedDifficulty, setId],
  )

  useEffect(() => {
    if (kind !== "apprentice") return
    let cancelled = false
    studentApi
      .topics()
      .then((loaded) => {
        if (!cancelled) setTopics(loaded)
      })
      .catch((error) => {
        if (!cancelled) {
          toast({
            title: extractErrorMessage(error, cs.student.generationError),
            variant: "destructive",
          })
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTopics(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, toast])

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
    if (kind === "apprentice" && (!topicId || !pointValue)) return
    setIsStarting(true)
    try {
      const input: StartStreakRunInput =
        kind === "apprentice"
          ? {
              kind,
              topicId,
              pointValue: Number(pointValue),
              mode: setId ? undefined : modeFilter || undefined,
              setId: setId || undefined,
            }
          : { kind }
      const run = await studentApi.startStreakRun(input)
      // `input` travels alongside the run so the results page can offer an
      // instant "Znovu" that repeats this exact configuration.
      navigate("/test/streak/active", { state: { run, input } })
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.streak.setupStartError),
        variant: "destructive",
      })
    } finally {
      setIsStarting(false)
    }
  }, [kind, topicId, pointValue, setId, modeFilter, navigate, toast])

  const title = kind === "apprentice" ? cs.test.modeUcenTitle : cs.test.modeMistrTitle
  const description =
    kind === "apprentice" ? cs.test.modeUcenDescription : cs.test.modeMistrDescription

  if (kind === "master") {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>

        <Card className="max-w-lg">
          <CardContent className="pt-6">
            <Button onClick={handleStart} disabled={isStarting} size="lg">
              {isStarting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Swords className="size-4 mr-2" />
              )}
              {isStarting ? cs.streak.setupStarting : cs.streak.setupStartButton}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

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
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{cs.student.noTopics}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="streak-topic">{cs.student.topicLabel}</Label>
            <Select value={topicId} onValueChange={handleTopicChange}>
              <SelectTrigger id="streak-topic">
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
            <Label htmlFor="streak-difficulty">{cs.student.difficultyLabel}</Label>
            <Select
              value={pointValue}
              onValueChange={(value) => {
                setPointValue(value)
                setSetId("")
              }}
              disabled={!selectedTopic}
            >
              <SelectTrigger id="streak-difficulty">
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
            <Label htmlFor="streak-set">{cs.student.setLabel}</Label>
            <Select
              value={setId || "any"}
              onValueChange={(value) => setSetId(value === "any" ? "" : value)}
              disabled={!selectedDifficulty}
            >
              <SelectTrigger id="streak-set">
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
            <Label htmlFor="streak-question-type">{cs.student.questionTypeLabel}</Label>
            <Select
              value={selectedSet ? selectedSet.mode : modeFilter || "either"}
              onValueChange={(value) =>
                setModeFilter(value === "either" ? "" : (value as TemplateMode))
              }
              disabled={!!selectedSet}
            >
              <SelectTrigger id="streak-question-type">
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
            onClick={handleStart}
            disabled={!topicId || !pointValue || isStarting}
            className="lg:mb-0"
          >
            {isStarting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Swords className="size-4 mr-2" />
            )}
            {isStarting ? cs.streak.setupStarting : cs.streak.setupStartButton}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
