import { Loader2, Timer } from "lucide-react"
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
import type { StartTestInput, TestTopicOption } from "@/lib/types"

// Fixed for every student — there is deliberately no UI to change it.
const TIME_LIMIT_MINUTES = 50

/**
 * Where a student launches a timed test: they pick one of the tests the
 * teacher prepared (a topic flagged as a test), and the backend draws its
 * 12 questions (4 at each of 2/3/4 points, from all of the topic's sets)
 * at once. The generated session is handed to `/test/active` via router
 * state rather than a refetchable id: there is deliberately no "resume a
 * session" endpoint yet, so reloading the in-progress or results page
 * loses it.
 */
export function StudentTestStartPage() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [testTopics, setTestTopics] = useState<TestTopicOption[]>([])
  const [isLoadingTopics, setIsLoadingTopics] = useState(true)
  const [topicId, setTopicId] = useState<string>("")
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    studentApi
      .testTopics()
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
  }, [toast])

  const handleStart = useCallback(async () => {
    if (!topicId) return

    setIsStarting(true)
    try {
      const input: StartTestInput = {
        topicId,
        timeLimitSeconds: TIME_LIMIT_MINUTES * 60,
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
  }, [topicId, navigate, toast])

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
          <CardTitle>{cs.test.startTitle}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground">{cs.test.noTestTopics}</CardContent>
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
