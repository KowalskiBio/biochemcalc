import { Trash2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RefreshOverlay } from "@/components/ui/refresh-overlay"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { type BiomoleculeHistoryEntry, biomoleculesApi } from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"

const historyStrings = cs.biomolekuly.history

/**
 * Teacher-side log of the biomolecules module — the same trail shape as the
 * laboratorní výpočty history page: every mutation records its actor and
 * what changed, so a second pair of eyes (or future-you) can review edits.
 */
export function BiomoleculesHistoryPage() {
  const [entries, setEntries] = useState<BiomoleculeHistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasLoadedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [isClearOpen, setIsClearOpen] = useState(false)
  const { toast } = useToast()

  const loadHistory = useCallback(async () => {
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    setError(null)
    try {
      const data = await biomoleculesApi.biomoleculeHistory({ limit: 50 })
      setEntries(data)
    } catch (err) {
      setError(extractErrorMessage(err, historyStrings.loadError))
    } finally {
      hasLoadedRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  const handleClearConfirm = useCallback(async () => {
    setIsClearOpen(false)
    try {
      await biomoleculesApi.clearBiomoleculeHistory()
      setEntries([])
      toast({ title: historyStrings.cleared })
    } catch (err) {
      toast({
        title: historyStrings.clearError,
        description: extractErrorMessage(err, historyStrings.clearError),
        variant: "destructive",
      })
    }
  }, [toast])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {historyStrings.title}
          </h1>
          <p className="text-sm text-muted-foreground">{historyStrings.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsClearOpen(true)}
            disabled={entries.length === 0}
          >
            <Trash2 className="size-4 mr-2" />
            {historyStrings.clearAction}
          </Button>
          <Badge variant="outline">{entriesCountText(entries.length)}</Badge>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4">
            <p className="text-center text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              <Skeleton className="h-5 w-40" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center px-8 py-12 text-center">
            <p className="text-muted-foreground">{historyStrings.empty}</p>
          </CardContent>
        </Card>
      ) : (
        <RefreshOverlay isRefreshing={isRefreshing}>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{historyStrings.pageTitle}</CardTitle>
              <CardDescription>{historyStrings.pageDescription}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{historyStrings.whenColumn}</TableHead>
                    <TableHead>{historyStrings.whoColumn}</TableHead>
                    <TableHead>{historyStrings.actionColumn}</TableHead>
                    <TableHead>{historyStrings.detailColumn}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {new Date(entry.createdAt).toLocaleString("cs-CZ")}
                      </TableCell>
                      <TableCell className="font-medium">{entry.username}</TableCell>
                      <TableCell>
                        <p className="text-sm">
                          {actionLabel(entry.action)}
                          {` „${entry.label}“`}
                        </p>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.detail ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </RefreshOverlay>
      )}

      <ConfirmDialog
        open={isClearOpen}
        onOpenChange={setIsClearOpen}
        title={historyStrings.clearAction}
        description={historyStrings.clearConfirm}
        confirmLabel={cs.common.delete}
        cancelLabel={cs.common.cancel}
        onConfirm={() => void handleClearConfirm()}
      />
    </div>
  )
}

/** Czech sentence fragment for one action, mirroring the column meaning. */
function actionLabel(action: string): string {
  const strings = historyStrings
  if (action === "create") return strings.actionCreated
  if (action === "delete") return strings.actionDeleted
  if (action === "reorder") return strings.actionReordered
  if (action === "settings") return strings.actionSettings
  return strings.actionUpdated
}

/** "{n} záznam/záznamy/záznamů" — the badge's count text. */
function entriesCountText(count: number): string {
  const word = count === 1 ? "záznam" : count >= 2 && count <= 4 ? "záznamy" : "záznamů"
  return `${count} ${word}`
}
