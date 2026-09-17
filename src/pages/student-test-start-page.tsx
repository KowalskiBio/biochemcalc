import { Flag, Loader2, Timer } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
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
import type { StartTestInput, TestKind, TestTopicOption } from "@/lib/types"

// Fixed for every student — there is deliberately no UI to change it.
const TIME_LIMIT_MINUTES = 50

interface StudentTestStartPageProps {
  kind: TestKind
}

/**
 * Where a student launches a timed test: they pick one of the tests the
 * teacher prepared for this kind (a topic flagged as a test that offers it),
 * and the backend draws its questions at each of 2/3/4 points from all of
 * the topic's sets at once — 5 per band for the úvodní test (15), 4 for the
 * průběžný one (12).
 *
 * Both kinds share this component, one route pair each. The generated
 * session is handed to `/test/{kind}/active` via router state rather than a
 * refetchable id: there is deliberately no "resume a session" endpoint yet,
 * so reloading the in-progress or results page loses it.
 */
export function StudentTestStartPage({ kind }: StudentTestStartPageProps) {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [testTopics, setTestTopics] = useState<TestTopicOption[]>([])
  const [isLoadingTopics, setIsLoadingTopics] = useState(true)
  const [topicId, setTopicId] = useState<string>("")
  const [isStarting, setIsStarting] = useState(false)

  const isUvodni = kind === "uvodni"
  const title = isUvodni ? cs.test.modeUvodniTitle : cs.test.modePrubeznyTitle
  const description = isUvodni ? cs.test.startDescriptionUvodni : cs.test.startDescriptionPrubezny

  useEffect(() => {
    let cancelled = false
    studentApi
      .testTopics(kind)
      .then((loaded) => {
        if (cancelled) return
        setTestTopics(loaded)
      })
      .catch((error) => {
        if (cancelled) return
        toast({
          title: extractErrorMessage(error, cs.test.startError),
          variant: "destructive",
        })
      })
      .finally(() => {
        if (!cancelled) setIsLoadingTopics(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, toast])

  const handleStart = useCallback(async () => {
    if (!topicId) return

    setIsStarting(true)
    try {
      const input: StartTestInput = {
        topicId,
        kind,
        timeLimitSeconds: TIME_LIMIT_MINUTES * 60,
      }
      const session = await studentApi.startTest(input)
      // `input` travels alongside the session so the in-progress and results
      // pages know which kind they belong to (they share one component per
      // route pair), and so the results page can offer an instant "Znovu"
      // that repeats this exact configuration.
      navigate(`/test/${kind}/active`, { state: { session, input } })
    } catch (error) {
      toast({ title: extractErrorMessage(error, cs.test.startError), variant: "destructive" })
    } finally {
      setIsStarting(false)
    }
  }, [topicId, kind, navigate, toast])

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

  if (testTopics.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{cs.test.noTestTopics}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
        {isUvodni && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-primary">
            <Flag className="size-4 shrink-0" />
            {cs.test.uvodniDisclosure}
          </p>
        )}
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-6 sm:grid-cols-2 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="test-topic">{cs.test.testTopicLabel}</Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger id="test-topic">
                <SelectValue placeholder={cs.test.testTopicPlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {testTopics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    Test - {topic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              {cs.test.timeLimitFixedLabel(TIME_LIMIT_MINUTES)}
            </p>
          </div>

          <Button onClick={handleStart} disabled={!topicId || isStarting} className="lg:mb-0">
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
