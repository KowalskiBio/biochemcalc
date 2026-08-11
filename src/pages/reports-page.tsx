import { Flag, Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { FormattedResult } from "@/components/ui/formatted-result"
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
import { resolveOptionsPrecision } from "@/lib/math-utils"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import { reportsApi } from "@/lib/reports-api"
import type { QuestionReportDetail, QuestionReportSummary } from "@/lib/types"
import { cn } from "@/lib/utils"

const OPTION_LABELS = ["a", "b", "c", "d", "e", "f"] as const

const pageContainerVariants = "space-y-6"
const emptyStateVariants = "flex flex-col items-center justify-center py-12 px-8 text-center"

export function ReportsPage() {
  const [summaries, setSummaries] = useState<QuestionReportSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<QuestionReportDetail | null>(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { toast } = useToast()

  const loadSummaries = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await reportsApi.list()
      setSummaries(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast({
        title: cs.reports.loadError,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        setIsDetailLoading(true)
        setDetailError(null)
        const data = await reportsApi.get(id)
        setSelectedReport(data)
        setSelectedReportId(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setDetailError(message)
        toast({
          title: cs.reports.detailError,
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsDetailLoading(false)
      }
    },
    [toast],
  )

  const handleRowClick = useCallback(
    (id: string) => {
      if (selectedReportId === id) {
        setSelectedReportId(null)
        setSelectedReport(null)
      } else {
        void loadDetail(id)
      }
    },
    [selectedReportId, loadDetail],
  )

  const handleDeleteClick = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeletingId(id)
    setIsDeleteDialogOpen(true)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deletingId) return
    setIsDeleteDialogOpen(false)

    try {
      await reportsApi.remove(deletingId)
      setSummaries((prev) => prev.filter((s) => s.id !== deletingId))
      if (selectedReportId === deletingId) {
        setSelectedReportId(null)
        setSelectedReport(null)
      }
      toast({
        title: cs.reports.deleteSuccess,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast({
        title: cs.reports.deleteError,
        description: message,
        variant: "destructive",
      })
    } finally {
      setDeletingId(null)
    }
  }, [deletingId, selectedReportId, toast])

  const handleDeleteCancel = useCallback(() => {
    setIsDeleteDialogOpen(false)
    setDeletingId(null)
  }, [])

  useEffect(() => {
    loadSummaries()
  }, [loadSummaries])

  const getStatusLabel = useCallback((isCorrect: boolean | null) => {
    if (isCorrect === null) return cs.reports.statusPending
    if (isCorrect) return cs.reports.statusAnsweredCorrect
    return cs.reports.statusAnsweredIncorrect
  }, [])

  const getModeLabel = useCallback((mode: "closed" | "open") => {
    return mode === "closed" ? cs.reports.modeClosed : cs.reports.modeOpen
  }, [])

  return (
    <div className={pageContainerVariants}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.reports.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{cs.reports.description}</p>
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
          <CardHeader>
            <CardTitle className="text-lg">
              <Skeleton className="h-5 w-32" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      ) : summaries.length === 0 ? (
        <Card>
          <CardHeader />
          <CardContent className={emptyStateVariants}>
            <p className="text-muted-foreground">{cs.reports.empty}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{cs.reports.title}</CardTitle>
            <CardDescription>{cs.reports.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{cs.reports.columns.student}</TableHead>
                  <TableHead>{cs.reports.columns.topic}</TableHead>
                  <TableHead>{cs.reports.columns.difficulty}</TableHead>
                  <TableHead>{cs.reports.columns.message}</TableHead>
                  <TableHead>{cs.reports.columns.date}</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summaries.map((summary) => (
                  <TableRow
                    key={summary.id}
                    onClick={() => handleRowClick(summary.id)}
                    className={cn(
                      "cursor-pointer transition-colors",
                      selectedReportId === summary.id && "bg-muted/50",
                    )}
                  >
                    <TableCell className="font-medium">{summary.studentUsername}</TableCell>
                    <TableCell>{summary.topicName}</TableCell>
                    <TableCell>
                      {cs.reports.difficultyPoints.replace("{value}", String(summary.pointValue))}
                    </TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {summary.message.length > 80
                        ? `${summary.message.slice(0, 80)}...`
                        : summary.message}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {new Date(summary.createdAt).toLocaleString("cs-CZ")}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteClick(summary.id, e)}
                        className="size-8 h-8 w-8"
                        aria-label={cs.reports.delete}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detail panel - shown below table when a report is selected */}
      {selectedReport && !isDetailLoading && !detailError && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{cs.reports.reportedQuestion}</CardTitle>
            <CardDescription>{cs.reports.selectPrompt}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Question text */}
            <div className="space-y-2">
              <QuestionTextRenderer
                text={selectedReport.questionText}
                variables={selectedReport.variables}
                variant={{
                  assignedValues: selectedReport.assignedValues,
                  assignedStrings: selectedReport.assignedStrings,
                }}
                constants={selectedReport.constants}
              />
              <Badge variant="outline" className="ml-2">
                {cs.reports.difficultyPoints.replace("{value}", String(selectedReport.pointValue))}
              </Badge>
            </div>

            {/* For closed mode: show option list with only correct highlighted */}
            {selectedReport.mode === "closed" && selectedReport.answerSlots.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(() => {
                  // Small-magnitude answers (e.g. sub-1% results) can collapse
                  // to identical strings at the default precision, so widen
                  // per slot just enough to keep every option distinct.
                  const optionsPrecision = selectedReport.answerSlots.map((slot) =>
                    resolveOptionsPrecision(slot.numericOptions ?? []),
                  )
                  return Array.from(
                    { length: selectedReport.answerSlots[0]?.numericOptions?.length ?? 0 },
                    (_, rowIdx) => {
                      const label = OPTION_LABELS[rowIdx] ?? String(rowIdx + 1)
                      const option = rowIdx + 1
                      const isTheAnswer = selectedReport.correctOption === option

                      return (
                        <div
                          key={label}
                          className={cn(
                            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                            isTheAnswer && "border-green-500 bg-green-50 dark:bg-green-950/30",
                          )}
                        >
                          <span className="font-semibold">{label})</span>
                          <span>
                            {selectedReport.answerSlots.map((slot, slotIdx) => {
                              const value = slot.numericOptions?.[rowIdx]
                              if (value == null) return null
                              return (
                                <span key={slot.symbol ?? slotIdx}>
                                  {slotIdx > 0 && ", "}
                                  <FormattedResult
                                    value={value}
                                    unit={slot.unit ?? selectedReport.resultUnit}
                                    precision={optionsPrecision[slotIdx]}
                                  />
                                </span>
                              )
                            })}
                          </span>
                        </div>
                      )
                    },
                  )
                })()}
              </div>
            )}

            {/* Correct answers block */}
            {(selectedReport.correctAnswers.length > 0 || selectedReport.correctOption != null) && (
              <div
                className={cn("rounded-md border px-4 py-3 space-y-1", "border-muted bg-muted/30")}
              >
                <p className="font-medium">{cs.reports.correctAnswer}</p>
                {selectedReport.correctAnswers.length > 1 ? (
                  <p className="text-sm text-muted-foreground">
                    {cs.reports.correctAnswers}:{" "}
                    {selectedReport.correctAnswers.map((answer, idx) => (
                      <span key={answer.symbol ?? idx}>
                        {idx > 0 && "; "}
                        {answer.symbol ? `${answer.symbol} = ` : ""}
                        <FormattedResult
                          value={answer.value}
                          unit={answer.unit ?? selectedReport.resultUnit}
                        />
                      </span>
                    ))}
                  </p>
                ) : selectedReport.correctAnswers.length === 1 ? (
                  <p className="text-sm text-muted-foreground">
                    {cs.reports.correctAnswer}:{" "}
                    {selectedReport.correctAnswers[0].symbol
                      ? `${selectedReport.correctAnswers[0].symbol} = `
                      : ""}
                    <FormattedResult
                      value={selectedReport.correctAnswers[0].value}
                      unit={selectedReport.correctAnswers[0].unit ?? selectedReport.resultUnit}
                    />
                  </p>
                ) : selectedReport.correctOption != null ? (
                  <p className="text-sm text-muted-foreground">
                    {cs.reports.correctAnswer}:{" "}
                    {OPTION_LABELS[selectedReport.correctOption - 1] ??
                      String(selectedReport.correctOption)}
                  </p>
                ) : null}
              </div>
            )}

            {/* Meta panel */}
            <div className="space-y-4">
              <h3 className="font-medium">{cs.reports.metaHeading}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{cs.reports.metaStudent}</p>
                  <p className="font-medium">{selectedReport.studentUsername}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{cs.reports.metaDate}</p>
                  <p className="font-medium">
                    {new Date(selectedReport.createdAt).toLocaleString("cs-CZ")}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{cs.reports.metaTopic}</p>
                  <p className="font-medium">{selectedReport.topicName}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{cs.reports.metaPointValue}</p>
                  <p className="font-medium">
                    {cs.reports.difficultyPoints.replace(
                      "{value}",
                      String(selectedReport.pointValue),
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{cs.reports.metaMode}</p>
                  <p className="font-medium">{getModeLabel(selectedReport.mode)}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">{cs.reports.metaStatus}</p>
                  <p className="font-medium">{getStatusLabel(selectedReport.isCorrect)}</p>
                </div>
              </div>
            </div>

            {/* Source links */}
            {selectedReport.location && (
              <div className="flex flex-wrap gap-2 pt-4">
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/topics/${selectedReport.location.topicId}`}>
                    <Flag className="size-4 mr-2" />
                    {cs.reports.openTopic}
                  </Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/sets/${selectedReport.location.setId}`}>
                    <Flag className="size-4 mr-2" />
                    {cs.reports.openSet}
                  </Link>
                </Button>
              </div>
            )}
            {selectedReport.location === null && (
              <p className="text-sm text-muted-foreground italic pt-4">
                {cs.reports.templateDeleted}
              </p>
            )}

            {/* Student message */}
            <div className="pt-4 border-t border-border">
              <h3 className="font-medium mb-2">{cs.reports.messageHeading}</h3>
              <p className="text-sm bg-muted/50 p-3 rounded-md whitespace-pre-wrap">
                {selectedReport.message}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isDetailLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="size-8 animate-spin mx-auto mb-2" />
            <p className="text-muted-foreground">{cs.reports.detailLoading}</p>
          </CardContent>
        </Card>
      )}

      {detailError && (
        <Card>
          <CardContent className="py-4">
            <p className="text-destructive text-center">{detailError}</p>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleDeleteCancel()
        }}
        title={cs.reports.deleteConfirmTitle}
        description={cs.reports.deleteConfirmDescription}
        confirmLabel={cs.common.delete}
        cancelLabel={cs.common.cancel}
        onConfirm={handleDeleteConfirm}
        variant="destructive"
      />
    </div>
  )
}
