import { Trophy } from "lucide-react"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type { LeaderboardEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"

/**
 * Who has calculated what. Ranked by correctly answered questions — the
 * server counts one score per attempt and refuses to re-grade one, so the
 * only way up the board is to answer more questions correctly.
 */
export function StudentLeaderboardPage() {
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
        <p className="text-muted-foreground text-sm">{cs.student.leaderboardDescription}</p>
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
            <p className="py-6 text-center text-muted-foreground">
              {cs.student.leaderboardLoading}
            </p>
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
    </div>
  )
}
