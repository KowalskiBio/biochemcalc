import { cva } from "class-variance-authority"
import { Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
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
import { ApiError, historyApi } from "@/lib/api"
import type { HistoryEntry } from "@/lib/types"
import { cn } from "@/lib/utils"

const pageContainerVariants = cva("space-y-6")
const emptyStateVariants = cva("flex flex-col items-center justify-center py-12 px-8 text-center")

export function HistoryPage() {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isClearHistoryDialogOpen, setIsClearHistoryDialogOpen] = useState(false)
  const { toast } = useToast()

  const loadHistory = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await historyApi.listAll(50, 0)
      setEntries(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const handleClearHistoryClick = useCallback(() => {
    setIsClearHistoryDialogOpen(true)
  }, [])

  const handleClearHistoryConfirm = useCallback(async () => {
    setIsClearHistoryDialogOpen(false)

    try {
      await historyApi.clearAll()
      setEntries([])
      toast({
        title: cs.history.clearHistorySuccess,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.history.clearHistoryError,
        description: message,
        variant: "destructive",
      })
    }
  }, [toast])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  return (
    <div
      className={cn(pageContainerVariants())}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cs.history.title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{cs.history.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearHistoryClick}
            disabled={entries.length === 0}
          >
            <Trash2 className="size-4 mr-2" />
            {cs.history.clearHistory}
          </Button>
          <Badge variant="outline">
            {entries.length} záznam
            {entries.length === 1 ? "ů" : entries.length >= 2 && entries.length <= 4 ? "y" : "ů"}
          </Badge>
        </div>
      </div>

      {error && (
        <Card>
          <CardContent className="py-4">
            <p className="text-destructive text-center">{error}</p>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="size-8 animate-spin mx-auto mb-2" />
            <p className="text-foreground-muted">Načítám historii...</p>
          </CardContent>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <CardHeader />
          <CardContent className={cn(emptyStateVariants())}>
            <p className="text-muted-foreground">{cs.history.emptyState.description}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{cs.history.pageTitle}</CardTitle>
            <CardDescription>{cs.history.pageDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Datum</TableHead>
                  <TableHead>Šablona ID</TableHead>
                  <TableHead>Proměnná / Otázka</TableHead>
                  <TableHead>Pole</TableHead>
                  <TableHead>Stará hodnota</TableHead>
                  <TableHead>Nová hodnota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.changedAt).toLocaleString("cs-CZ")}</TableCell>
                    <TableCell className="font-mono text-sm">{entry.templateId}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {entry.kind === "template" ? "Otázka" : entry.variableId}
                    </TableCell>
                    <TableCell>
                      {entry.fieldName in cs.history.historyFields
                        ? cs.history.historyFields[
                            entry.fieldName as keyof typeof cs.history.historyFields
                          ]
                        : entry.fieldName}
                    </TableCell>
                    <TableCell>{entry.oldValue || "—"}</TableCell>
                    <TableCell>{entry.newValue || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <ConfirmDialog
        open={isClearHistoryDialogOpen}
        onOpenChange={setIsClearHistoryDialogOpen}
        title={cs.history.clearHistory}
        description={cs.history.clearHistoryConfirm}
        confirmLabel={cs.common.delete}
        cancelLabel={cs.common.cancel}
        onConfirm={handleClearHistoryConfirm}
      />
    </div>
  )
}
