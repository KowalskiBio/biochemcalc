import { Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { RichText } from "@/components/ui/rich-text"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
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
import {
  type BiomoleculeQuestionReportDetail,
  type BiomoleculeQuestionReportSnapshot,
  type BiomoleculeQuestionReportSummary,
  biomoleculeReportsApi,
} from "@/lib/biomolecule-reports-api"
import { type ProjectionSpec, parseProjection } from "@/lib/molecules/render/projection"
import { stripRichMarkup } from "@/lib/rich-text"
import { cn } from "@/lib/utils"

const strings = cs.biomolekuly.reports

const pageContainerVariants = "space-y-6"
const emptyStateVariants = "flex flex-col items-center justify-center py-12 px-8 text-center"

const QUESTION_TYPE_KEYS = [
  "nameToLetter",
  "letterToName",
  "nameToStructure",
  "structureToName",
  "letterToStructure",
  "structureToLetter",
  "characteristic",
] as const

export type BiomoleculeQuestionTypeKey = (typeof QUESTION_TYPE_KEYS)[number]

function isQuestionTypeKey(value: string): value is BiomoleculeQuestionTypeKey {
  return (QUESTION_TYPE_KEYS as readonly string[]).includes(value)
}

/** Czech label for one of the engine's question types; unknown types stay raw. */
export function questionTypeLabel(type: string): string {
  return isQuestionTypeKey(type) ? strings.questionTypes[type] : type
}

/** Table-cell preview of the student's message, capped at `max` characters. */
export function truncateMessage(message: string, max = 80): string {
  return message.length > max ? `${message.slice(0, max)}...` : message
}

/** Czech-formatted report timestamp; malformed input falls back to the raw value. */
export function formatReportedAt(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("cs-CZ")
}

/** Czech label for the student's answer state at the time of reporting. */
export function answeredStatusLabel(answeredCorrect: boolean | null): string {
  if (answeredCorrect === null) return strings.statusPending
  return answeredCorrect ? strings.statusCorrect : strings.statusIncorrect
}

/**
 * Narrow the snapshot's opaque projection to a `ProjectionSpec`. The snapshot
 * normally stores the already-parsed spec as JSON, but an old bug could have
 * left a raw string (or garbage) behind — `parseProjection` covers both and
 * returns `null` on anything structurally invalid, so the caller can fall back
 * to the SMILES depiction.
 */
export function parseSnapshotProjection(raw: unknown): ProjectionSpec | null {
  if (raw === null || raw === undefined) return null
  let serialized: string
  if (typeof raw === "string") {
    serialized = raw
  } else {
    try {
      serialized = JSON.stringify(raw)
    } catch {
      return null
    }
  }
  return parseProjection(serialized)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

/**
 * Defensive normalization of the frozen snapshot. Reports are stored as
 * verbatim JSON, so old/malformed rows (missing fields, wrong types, null)
 * must still render whatever survived instead of crashing the page.
 */
export function normalizeSnapshot(raw: unknown): BiomoleculeQuestionReportSnapshot {
  const source = isRecord(raw) ? raw : {}
  const target = isRecord(source.target) ? source.target : {}
  const prompt = isRecord(source.prompt) ? source.prompt : {}

  const options = (Array.isArray(source.options) ? source.options : [])
    .filter(isRecord)
    .map((option) => {
      const display: BiomoleculeQuestionReportSnapshot["options"][number]["display"] =
        option.display === "letter" || option.display === "structure" ? option.display : "name"
      const smiles = typeof option.smiles === "string" ? option.smiles : undefined
      return {
        key: readString(option.key),
        display,
        name: readString(option.name, readString(option.key)),
        ...(smiles !== undefined ? { smiles } : {}),
        ...(typeof option.haworth === "boolean" ? { haworth: option.haworth } : {}),
        ...(typeof option.fischer === "boolean" ? { fischer: option.fischer } : {}),
        projection: option.projection ?? null,
        correct: option.correct === true,
      }
    })

  const openAnswerSource = source.openAnswer
  const openAnswer =
    isRecord(openAnswerSource) && Array.isArray(openAnswerSource.acceptedAnswers)
      ? {
          acceptedAnswers: openAnswerSource.acceptedAnswers.filter(
            (answer): answer is string => typeof answer === "string",
          ),
        }
      : null

  const promptSmiles = typeof prompt.smiles === "string" ? prompt.smiles : undefined

  return {
    questionType: readString(source.questionType),
    scopeSlug: readString(source.scopeSlug),
    target: {
      name: readString(target.name),
      smiles: readString(target.smiles),
    },
    prompt: {
      kind: readString(prompt.kind),
      text: readString(prompt.text),
      ...(promptSmiles !== undefined ? { smiles: promptSmiles } : {}),
      ...(typeof prompt.haworth === "boolean" ? { haworth: prompt.haworth } : {}),
      ...(typeof prompt.fischer === "boolean" ? { fischer: prompt.fischer } : {}),
      projection: prompt.projection ?? null,
    },
    options,
    openAnswer,
    answeredCorrect: typeof source.answeredCorrect === "boolean" ? source.answeredCorrect : null,
  }
}

function MicroLabel({ children }: { children: string }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </p>
  )
}

function SnapshotOption({
  option,
}: {
  option: BiomoleculeQuestionReportSnapshot["options"][number]
}) {
  const projection = parseSnapshotProjection(option.projection)
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
        option.correct && "border-green-500 bg-green-50 dark:bg-green-950/30",
      )}
    >
      <span className="font-semibold">{option.key})</span>
      {option.display === "structure" && option.smiles ? (
        <StructureView
          smiles={option.smiles}
          projection={projection ?? undefined}
          haworth={option.haworth ?? true}
          fischer={option.fischer ?? true}
          size={140}
          title={stripRichMarkup(option.name || option.key)}
        />
      ) : (
        <span
          className={cn(
            option.display === "letter" ? "font-mono tabular text-lg font-semibold" : "font-medium",
          )}
        >
          {option.display === "letter" ? option.key : <RichText text={option.name} />}
        </span>
      )}
      {option.correct && (
        <Badge
          variant="outline"
          className="ml-auto border-green-500 text-green-700 dark:text-green-400"
        >
          {strings.correctBadge}
        </Badge>
      )}
    </div>
  )
}

function ReportDetailPanel({ report }: { report: BiomoleculeQuestionReportDetail }) {
  const snapshot = normalizeSnapshot(report.snapshot)
  const promptProjection = parseSnapshotProjection(snapshot.prompt.projection)
  const targetName = snapshot.target.name || "—"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {strings.reportedQuestion}
          <span className="text-muted-foreground">
            {" — "}
            <RichText text={targetName} />
          </span>
        </CardTitle>
        <CardDescription>
          {questionTypeLabel(snapshot.questionType) || strings.selectPrompt}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Prompt */}
        <div className="space-y-2">
          <MicroLabel>{strings.promptHeading}</MicroLabel>
          {snapshot.prompt.text && (
            <p
              className={cn(
                "text-lg font-semibold tracking-tight",
                snapshot.prompt.kind === "letter" && "font-mono tabular",
              )}
            >
              <RichText text={snapshot.prompt.text} />
            </p>
          )}
          {snapshot.prompt.kind === "structure" && snapshot.prompt.smiles && (
            <StructureView
              smiles={snapshot.prompt.smiles}
              projection={promptProjection ?? undefined}
              haworth={snapshot.prompt.haworth ?? true}
              fischer={snapshot.prompt.fischer ?? true}
              size={180}
              title={cs.biomolekuly.quiz.promptStructureLabel}
              className="mx-auto"
            />
          )}
        </div>

        {/* Options, with the correct answer(s) highlighted. */}
        {snapshot.options.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {snapshot.options.map((option) => (
              <SnapshotOption key={option.key} option={option} />
            ))}
          </div>
        )}

        {/* Accepted open answers */}
        {snapshot.openAnswer && (
          <div className="space-y-1 rounded-md border border-muted bg-muted/30 px-4 py-3">
            <p className="font-medium">{strings.openAnswersHeading}</p>
            {snapshot.openAnswer.acceptedAnswers.length > 0 ? (
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                {snapshot.openAnswer.acceptedAnswers.map((answer) => (
                  <li key={answer} className="font-mono">
                    <RichText text={answer} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">—</p>
            )}
          </div>
        )}

        {/* Meta panel */}
        <div className="space-y-4">
          <h3 className="font-medium">{strings.metaHeading}</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <MicroLabel>{strings.metaStudent}</MicroLabel>
              <p className="font-medium">{report.studentUsername}</p>
            </div>
            <div className="space-y-1">
              <MicroLabel>{strings.metaDate}</MicroLabel>
              <p className="font-medium">{formatReportedAt(report.createdAt)}</p>
            </div>
            <div className="space-y-1">
              <MicroLabel>{strings.metaScope}</MicroLabel>
              <p className="font-mono text-sm font-medium">
                {snapshot.scopeSlug || report.scopeSlug || "—"}
              </p>
            </div>
            <div className="space-y-1">
              <MicroLabel>{strings.metaType}</MicroLabel>
              <p className="font-medium">{questionTypeLabel(snapshot.questionType) || "—"}</p>
            </div>
            <div className="space-y-1">
              <MicroLabel>{strings.metaAnswered}</MicroLabel>
              <p className="font-medium">{answeredStatusLabel(snapshot.answeredCorrect)}</p>
            </div>
          </div>
        </div>

        {/* Student message */}
        <div className="space-y-2 border-t border-border pt-4">
          <h3 className="font-medium">{strings.messageHeading}</h3>
          <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm">{report.message}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function BiomoleculesReportsPage() {
  const [summaries, setSummaries] = useState<BiomoleculeQuestionReportSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [selectedReport, setSelectedReport] = useState<BiomoleculeQuestionReportDetail | null>(null)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const { toast } = useToast()

  const loadSummaries = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await biomoleculeReportsApi.listQuestionReports()
      setSummaries(data)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast({
        title: strings.loadError,
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
        const data = await biomoleculeReportsApi.getQuestionReport(id)
        setSelectedReport(data)
        setSelectedReportId(id)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setDetailError(message)
        toast({
          title: strings.detailError,
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
      await biomoleculeReportsApi.deleteQuestionReport(deletingId)
      setSummaries((prev) => prev.filter((summary) => summary.id !== deletingId))
      if (selectedReportId === deletingId) {
        setSelectedReportId(null)
        setSelectedReport(null)
      }
      toast({
        title: strings.deleteSuccess,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast({
        title: strings.deleteError,
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

  return (
    <div className={pageContainerVariants}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{strings.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{strings.description}</p>
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
            <p className="text-muted-foreground">{strings.empty}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{strings.title}</CardTitle>
            <CardDescription>{strings.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{strings.columns.student}</TableHead>
                  <TableHead>{strings.columns.scope}</TableHead>
                  <TableHead>{strings.columns.message}</TableHead>
                  <TableHead>{strings.columns.date}</TableHead>
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
                    <TableCell className="font-mono text-sm">{summary.scopeSlug || "—"}</TableCell>
                    <TableCell className="max-w-[300px] truncate">
                      {truncateMessage(summary.message)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatReportedAt(summary.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleDeleteClick(summary.id, e)}
                        className="size-8 h-8 w-8"
                        aria-label={strings.delete}
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

      {/* Detail panel - shown below the table when a report is selected. */}
      {selectedReport && !isDetailLoading && !detailError && (
        <ReportDetailPanel report={selectedReport} />
      )}

      {isDetailLoading && (
        <Card>
          <CardContent className="py-8 text-center">
            <Loader2 className="mx-auto mb-2 size-8 animate-spin" />
            <p className="text-muted-foreground">{strings.detailLoading}</p>
          </CardContent>
        </Card>
      )}

      {detailError && (
        <Card>
          <CardContent className="py-4">
            <p className="text-center text-destructive">{detailError}</p>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) handleDeleteCancel()
        }}
        title={strings.deleteConfirmTitle}
        description={strings.deleteConfirmDescription}
        confirmLabel={cs.common.delete}
        cancelLabel={cs.common.cancel}
        onConfirm={handleDeleteConfirm}
        variant="destructive"
      />
    </div>
  )
}
