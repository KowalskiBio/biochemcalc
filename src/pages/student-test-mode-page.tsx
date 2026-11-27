import { Crown, Flag, Loader2, Swords, Timer } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type { PracticeTopic, StartStreakRunInput, TemplateMode } from "@/lib/types"
import { cn } from "@/lib/utils"

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

const MODES = [
  {
    to: "/test/uvodni",
    icon: Flag,
    title: cs.test.modeUvodniTitle,
    description: cs.test.modeUvodniDescription,
  },
  {
    to: "/test/prubezny",
    icon: Timer,
    title: cs.test.modePrubeznyTitle,
    description: cs.test.modePrubeznyDescription,
  },
  {
    to: "/test/mistr",
    icon: Crown,
    title: cs.test.modeMistrTitle,
    description: cs.test.modeMistrDescription,
  },
] as const

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-h-[36px] cursor-pointer rounded-[4px] border px-3 text-sm font-medium",
        "transition-colors duration-150",
        FOCUS_RING_CLASS,
        active
          ? "border-primary bg-primary/10 text-primary"
          : "bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function MicroLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * Učeň with its choices laid out in the block: the topics first, and once
 * one is picked its difficulties, sets and question types as chips, then
 * the start button. Same filters (and the same set-locks-mode guard) the
 * practice generator offers.
 */
function UcenBlock() {
  const { toast } = useToast()
  const navigate = useNavigate()

  const [topics, setTopics] = useState<PracticeTopic[] | null>(null)
  const [topicId, setTopicId] = useState("")
  const [pointValue, setPointValue] = useState<number | null>(null)
  const [setId, setSetId] = useState("")
  const [modeFilter, setModeFilter] = useState<"" | TemplateMode>("")
  const [isStarting, setIsStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    studentApi
      .topics()
      .then((loaded) => {
        if (!cancelled) setTopics(loaded)
      })
      .catch((error) => {
        if (cancelled) return
        setTopics([])
        toast({
          title: extractErrorMessage(error, cs.student.generationError),
          variant: "destructive",
        })
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  const selectedTopic = useMemo(
    () => topics?.find((t) => t.id === topicId) ?? null,
    [topics, topicId],
  )
  const selectedDifficulty = useMemo(
    () => selectedTopic?.difficulties.find((d) => d.pointValue === pointValue) ?? null,
    [selectedTopic, pointValue],
  )
  const selectedSet = useMemo(
    () => selectedDifficulty?.sets.find((s) => s.id === setId) ?? null,
    [selectedDifficulty, setId],
  )

  const pickTopic = (next: PracticeTopic) => {
    setTopicId(next.id)
    // Keep the difficulty when the new topic has it too; a single-difficulty
    // topic picks it straight away.
    const keeps = next.difficulties.some((d) => d.pointValue === pointValue)
    if (!keeps) {
      setPointValue(next.difficulties.length === 1 ? next.difficulties[0].pointValue : null)
    }
    setSetId("")
  }

  const handleStart = useCallback(async () => {
    if (!topicId || pointValue === null) return
    setIsStarting(true)
    try {
      const input: StartStreakRunInput = {
        kind: "apprentice",
        topicId,
        pointValue,
        mode: setId ? undefined : modeFilter || undefined,
        setId: setId || undefined,
      }
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
  }, [topicId, pointValue, setId, modeFilter, navigate, toast])

  const effectiveMode = selectedSet ? selectedSet.mode : modeFilter

  return (
    <Card className="sm:col-span-2 lg:col-span-3">
      <CardHeader className="space-y-4">
        <div className="space-y-1.5">
          <Swords className="size-6 text-primary" strokeWidth={1.75} />
          <CardTitle className="text-lg">{cs.test.modeUcenTitle}</CardTitle>
          <CardDescription>{cs.test.modeUcenDescription}</CardDescription>
        </div>

        <div className="space-y-2">
          <MicroLabel>{cs.student.topicLabel}</MicroLabel>
          {topics === null ? (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-11 rounded-[4px]" />
              ))}
            </div>
          ) : topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">{cs.student.noTopics}</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((topic) => {
                const active = topic.id === topicId
                return (
                  <button
                    key={topic.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickTopic(topic)}
                    className={cn(
                      "flex min-h-[44px] items-center rounded-[4px] border px-3 py-2 text-left text-sm font-medium",
                      "cursor-pointer transition-colors duration-150",
                      FOCUS_RING_CLASS,
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "bg-card hover:border-primary hover:bg-primary/5",
                    )}
                  >
                    <span className="min-w-0 truncate">{topic.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {selectedTopic && (
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <MicroLabel>{cs.student.difficultyLabel}</MicroLabel>
              <div className="flex flex-wrap gap-2">
                {selectedTopic.difficulties.map((difficulty) => (
                  <Chip
                    key={difficulty.pointValue}
                    active={difficulty.pointValue === pointValue}
                    onClick={() => {
                      setPointValue(difficulty.pointValue)
                      setSetId("")
                    }}
                  >
                    {cs.student.difficultyPoints.replace("{value}", String(difficulty.pointValue))}
                    <span className="ml-1.5 font-mono tabular text-xs opacity-70">
                      {difficulty.questionCount}
                    </span>
                  </Chip>
                ))}
              </div>
            </div>

            {selectedDifficulty && selectedDifficulty.sets.length > 1 && (
              <div className="space-y-2">
                <MicroLabel>{cs.student.setLabel}</MicroLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip active={setId === ""} onClick={() => setSetId("")}>
                    {cs.student.setAny}
                  </Chip>
                  {selectedDifficulty.sets.map((set) => (
                    <Chip key={set.id} active={set.id === setId} onClick={() => setSetId(set.id)}>
                      {set.name || cs.student.setIndex.replace("{index}", String(set.setIndex))}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            {selectedDifficulty && (
              <div className="space-y-2">
                <MicroLabel>{cs.student.questionTypeLabel}</MicroLabel>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["", cs.student.questionTypeEither],
                      ["closed", cs.student.questionTypeClosed],
                      ["open", cs.student.questionTypeOpen],
                    ] as const
                  ).map(([value, label]) => (
                    <Chip
                      key={value || "either"}
                      active={effectiveMode === value}
                      // A chosen set fixes the question type – the chips just show it.
                      onClick={() => {
                        if (!selectedSet) setModeFilter(value)
                      }}
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={handleStart} disabled={pointValue === null || isStarting}>
              {isStarting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Swords className="size-4 mr-2" />
              )}
              {isStarting ? cs.streak.setupStarting : cs.streak.setupStartButton}
            </Button>
          </div>
        )}
      </CardHeader>
    </Card>
  )
}

/**
 * The first choice a student makes before testing themselves: one of the two
 * timed batches ("Úvodní cvičný test", a topic's first, and "Průběžný
 * cvičný test", the recurring one), an endless run drawing from every topic
 * ("Mistr"), or the same but scoped – Učeň, whose topics sit right in its
 * block.
 */
export function StudentTestModePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.test.startTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.test.modePickerDescription}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODES.map(({ to, icon: Icon, title, description }) => (
          <Link key={to} to={to} className="block h-full">
            <Card className="h-full cursor-pointer transition-colors hover:border-primary hover:bg-primary/5">
              <CardHeader>
                <Icon className="size-6 text-primary" strokeWidth={1.75} />
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
        <UcenBlock />
      </div>
    </div>
  )
}
