import { Crown, Swords, Trophy } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useSection } from "@/hooks/use-section"
import { cs } from "@/i18n/cs"
import {
  type BiomoleculeLeaderboardEntry,
  type BiomoleculeStreakKind,
  type BiomoleculeStreakLeaderboardEntry,
  biomoleculesApi,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type {
  LeaderboardEntry,
  PracticeTopic,
  StreakLeaderboardEntry,
  StreakRunKind,
} from "@/lib/types"
import { cn, formatDecimalComma } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import { useCategoryNames, useMoleculeCategories } from "@/stores/biomolecule-data-store"

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * Best-streak board for one streak-run kind (Učeň/Mistr) — its own fetch,
 * its own table. "Apprentice" streaks from different topics or difficulties
 * aren't a meaningful comparison (a 10-streak on a narrow set and a
 * 10-streak on a huge mixed topic aren't the same accomplishment), so that
 * kind requires picking a topic and difficulty before it shows anything;
 * "master" always draws from everything and has nothing to scope by.
 */
function StreakLeaderboardCard({
  kind,
  title,
  icon: Icon,
}: {
  kind: StreakRunKind
  title: string
  icon: typeof Swords
}) {
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [topics, setTopics] = useState<PracticeTopic[]>([])
  const [topicId, setTopicId] = useState<string>("")
  const [pointValue, setPointValue] = useState<string>("")
  const [setId, setSetId] = useState<string>("")

  const [entries, setEntries] = useState<StreakLeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(kind === "master")
  const [error, setError] = useState<string | null>(null)

  const selectedTopic = useMemo(
    () => topics.find((t) => t.id === topicId) ?? null,
    [topics, topicId],
  )
  const selectedDifficulty = useMemo(
    () => selectedTopic?.difficulties.find((d) => String(d.pointValue) === pointValue) ?? null,
    [selectedTopic, pointValue],
  )

  useEffect(() => {
    if (kind !== "apprentice") return
    let cancelled = false
    studentApi
      .topics()
      .then((loaded) => {
        if (!cancelled) setTopics(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, cs.student.leaderboardError))
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  useEffect(() => {
    // A scoped "apprentice" board only makes sense once a topic and
    // difficulty are actually picked — pooling every topic together would
    // be comparing unrelated streaks, so there is nothing to fetch yet.
    if (kind === "apprentice" && (!topicId || !pointValue)) {
      setEntries([])
      return
    }
    let cancelled = false
    setIsLoading(true)
    studentApi
      .streakLeaderboard({
        kind,
        topicId: kind === "apprentice" ? topicId : undefined,
        pointValue: kind === "apprentice" ? Number(pointValue) : undefined,
        setId: kind === "apprentice" ? setId || undefined : undefined,
      })
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, cs.student.leaderboardError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind, topicId, pointValue, setId])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <Icon className="size-5 inline mr-2" />
          {title}
        </CardTitle>
        <CardDescription>{cs.student.leaderboardStreakDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {kind === "apprentice" && (
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="streak-board-topic">{cs.student.topicLabel}</Label>
              <Select
                value={topicId}
                onValueChange={(value) => {
                  setTopicId(value)
                  setPointValue("")
                  setSetId("")
                }}
              >
                <SelectTrigger id="streak-board-topic">
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
              <Label htmlFor="streak-board-difficulty">{cs.student.difficultyLabel}</Label>
              <Select
                value={pointValue}
                onValueChange={(value) => {
                  setPointValue(value)
                  setSetId("")
                }}
                disabled={!selectedTopic}
              >
                <SelectTrigger id="streak-board-difficulty">
                  <SelectValue placeholder={cs.student.difficultyPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {(selectedTopic?.difficulties ?? []).map((difficulty) => (
                    <SelectItem key={difficulty.pointValue} value={String(difficulty.pointValue)}>
                      {cs.student.difficultyPoints.replace(
                        "{value}",
                        String(difficulty.pointValue),
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="streak-board-set">{cs.student.setLabel}</Label>
              <Select
                value={setId || "any"}
                onValueChange={(value) => setSetId(value === "any" ? "" : value)}
                disabled={!selectedDifficulty}
              >
                <SelectTrigger id="streak-board-set">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{cs.student.setAny}</SelectItem>
                  {(selectedDifficulty?.sets ?? []).map((set) => (
                    <SelectItem key={set.id} value={set.id}>
                      {set.name || cs.student.setIndex.replace("{index}", String(set.setIndex))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {kind === "apprentice" && (!topicId || !pointValue) ? (
          <p className="py-6 text-center text-muted-foreground">
            {cs.student.leaderboardStreakPickScope}
          </p>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-destructive">{error}</p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            {cs.student.leaderboardStreakEmpty}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[70px]">{cs.student.leaderboardRank}</TableHead>
                <TableHead>{cs.student.leaderboardUser}</TableHead>
                <TableHead className="w-[120px] text-right">
                  {cs.student.leaderboardStreakCount}
                </TableHead>
                <TableHead className="w-[110px] text-right">
                  {cs.student.leaderboardStreakTime}
                </TableHead>
                <TableHead className="w-[110px] text-right">
                  {cs.student.leaderboardStreakTimePerAnswer}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, idx) => {
                const isMe = entry.userId === currentUserId
                return (
                  <TableRow key={entry.userId} className={cn(isMe && "bg-muted/50")}>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {idx + 1}.
                    </TableCell>
                    <TableCell className="font-medium">
                      {entry.username}
                      {isMe && (
                        <Badge variant="outline" className="ml-2">
                          {cs.student.leaderboardYou}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {entry.bestCorrectCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMinutesSeconds(entry.totalSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDecimalComma(entry.secondsPerAnswer.toFixed(1))} s
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Who has calculated what. The main table is ranked by correctly answered
 * practice/test questions — the server counts one score per attempt and
 * refuses to re-grade one, so the only way up is to answer more correctly.
 * Below it, two more boards track each streak-run kind's best run
 * (Učeň/Mistr) separately: those scores aren't points, they're "how far did
 * you get before your first mistake," which the main table doesn't capture.
 */
function CalculationsLeaderboard() {
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [entries, setEntries] = useState<LeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    studentApi
      .leaderboard()
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, cs.student.leaderboardError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const hasAnyActivity = entries.some((entry) => entry.answeredCount > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.student.leaderboardTitle}
        </h1>
        <p className="text-muted-foreground text-sm">
          {cs.student.leaderboardCalculationsDescription}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <Trophy className="size-5 inline mr-2" />
            {cs.student.leaderboardTitle}
          </CardTitle>
          <CardDescription>{cs.student.leaderboardDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="py-6 text-center text-destructive">{error}</p>
          ) : !hasAnyActivity ? (
            <p className="py-6 text-center text-muted-foreground">{cs.student.leaderboardEmpty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px]">{cs.student.leaderboardRank}</TableHead>
                  <TableHead>{cs.student.leaderboardUser}</TableHead>
                  <TableHead className="w-[110px] text-right">
                    {cs.student.leaderboardCorrect}
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    {cs.student.leaderboardAnswered}
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    {cs.student.leaderboardPoints}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, idx) => {
                  const isMe = entry.userId === currentUserId
                  return (
                    <TableRow key={entry.userId} className={cn(isMe && "bg-muted/50")}>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {idx + 1}.
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.username}
                        {isMe && (
                          <Badge variant="outline" className="ml-2">
                            {cs.student.leaderboardYou}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {entry.correctCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {entry.answeredCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{entry.points}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <StreakLeaderboardCard
          kind="apprentice"
          title={cs.student.leaderboardApprenticeTitle}
          icon={Swords}
        />
        <StreakLeaderboardCard
          kind="master"
          title={cs.student.leaderboardMasterTitle}
          icon={Crown}
        />
      </div>
    </div>
  )
}

/**
 * Biomolekuly's best-streak board for one run kind (Učeň/Mistr). Unlike the
 * calculations `StreakLeaderboardCard` there is nothing to scope by — every
 * biomolecules streak already draws from all categories — so the card is
 * just the table: fetch on mount, then loading/error/empty like the others.
 */
function BiomoleculeStreakLeaderboardCard({
  kind,
  title,
  icon: Icon,
}: {
  kind: BiomoleculeStreakKind
  title: string
  icon: typeof Swords
}) {
  const currentUserId = useAuthStore((s) => s.user?.id)
  const [entries, setEntries] = useState<BiomoleculeStreakLeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    biomoleculesApi
      .streakLeaderboard(kind)
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, cs.student.leaderboardError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [kind])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <Icon className="size-5 inline mr-2" />
          {title}
        </CardTitle>
        <CardDescription>{cs.student.leaderboardStreakDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <p className="py-6 text-center text-destructive">{error}</p>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            {cs.student.leaderboardStreakEmpty}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[70px]">{cs.student.leaderboardRank}</TableHead>
                <TableHead>{cs.student.leaderboardUser}</TableHead>
                <TableHead className="w-[120px] text-right">
                  {cs.student.leaderboardStreakCount}
                </TableHead>
                <TableHead className="w-[110px] text-right">
                  {cs.student.leaderboardStreakTime}
                </TableHead>
                <TableHead className="w-[110px] text-right">
                  {cs.student.leaderboardStreakTimePerAnswer}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry, idx) => {
                const isMe = entry.userId === currentUserId
                return (
                  <TableRow key={entry.userId} className={cn(isMe && "bg-muted/50")}>
                    <TableCell className="font-mono tabular-nums text-muted-foreground">
                      {idx + 1}.
                    </TableCell>
                    <TableCell className="font-medium">
                      {entry.username}
                      {isMe && (
                        <Badge variant="outline" className="ml-2">
                          {cs.student.leaderboardYou}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {entry.bestCorrectCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMinutesSeconds(entry.totalSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatDecimalComma(entry.secondsPerAnswer.toFixed(1))} s
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Biomolekuly's own board — same table layout as the calculations board, but
 * ranked by weighted points (a correct hard-mode answer counts double) and
 * optionally narrowed to one category. Below it, the two streak boards
 * (Učeň/Mistr) — same "how far before the first mistake" story as the
 * calculations section's, minus the scoping selectors.
 */
function BiomoleculesLeaderboard() {
  const currentUserId = useAuthStore((s) => s.user?.id)
  const nameOf = useCategoryNames()
  const categories = useMoleculeCategories()
  const [categoryId, setCategoryId] = useState<string>("")
  const [entries, setEntries] = useState<BiomoleculeLeaderboardEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setError(null)
    biomoleculesApi
      .leaderboard(categoryId || undefined)
      .then((loaded) => {
        if (!cancelled) setEntries(loaded)
      })
      .catch((err) => {
        if (!cancelled) setError(extractErrorMessage(err, cs.student.leaderboardError))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [categoryId])

  const hasAnyActivity = entries.some((entry) => entry.quizCount > 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.student.leaderboardBiomoleculesTitle}
        </h1>
        <p className="text-muted-foreground text-sm">
          {cs.student.leaderboardBiomoleculesDescription}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            <Trophy className="size-5 inline mr-2" />
            {cs.student.leaderboardTitle}
          </CardTitle>
          <CardDescription>{cs.student.leaderboardBiomoleculesDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 sm:max-w-xs">
            <Label htmlFor="bio-board-category">{cs.student.leaderboardCategoryLabel}</Label>
            <Select
              value={categoryId || "all"}
              onValueChange={(value) => setCategoryId(value === "all" ? "" : value)}
            >
              <SelectTrigger id="bio-board-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{cs.student.leaderboardCategoryAll}</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.slug} value={category.slug}>
                    {nameOf(category.slug)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="py-6 text-center text-destructive">{error}</p>
          ) : !hasAnyActivity ? (
            <p className="py-6 text-center text-muted-foreground">
              {cs.student.leaderboardBiomoleculesEmpty}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[70px]">{cs.student.leaderboardRank}</TableHead>
                  <TableHead>{cs.student.leaderboardUser}</TableHead>
                  <TableHead className="w-[110px] text-right">
                    {cs.student.leaderboardCorrect}
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    {cs.student.leaderboardAnswered}
                  </TableHead>
                  <TableHead className="w-[100px] text-right">
                    {cs.student.leaderboardPoints}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, idx) => {
                  const isMe = entry.userId === currentUserId
                  return (
                    <TableRow key={entry.userId} className={cn(isMe && "bg-muted/50")}>
                      <TableCell className="font-mono tabular-nums text-muted-foreground">
                        {idx + 1}.
                      </TableCell>
                      <TableCell className="font-medium">
                        {entry.username}
                        {isMe && (
                          <Badge variant="outline" className="ml-2">
                            {cs.student.leaderboardYou}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {entry.correctCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {entry.answeredCount}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{entry.points}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <BiomoleculeStreakLeaderboardCard
          kind="apprentice"
          title={cs.student.leaderboardApprenticeTitle}
          icon={Swords}
        />
        <BiomoleculeStreakLeaderboardCard
          kind="master"
          title={cs.student.leaderboardMasterTitle}
          icon={Crown}
        />
      </div>
    </div>
  )
}

/**
 * The leaderboard is a shared page, so it shows the board of whichever
 * section the user is in (see `useSection`).
 */
export function StudentLeaderboardPage() {
  const { section } = useSection()
  return section === "biomolecules" ? <BiomoleculesLeaderboard /> : <CalculationsLeaderboard />
}
