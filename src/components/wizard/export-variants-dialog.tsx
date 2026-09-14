import { Loader2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { DecimalInput } from "@/components/ui/decimal-input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { generationApi } from "@/lib/api"
import { QuestionTextRenderer } from "@/lib/render-question-text"
import type {
  ExportQuestion,
  Notation,
  QuestionDifficulty,
  TemplateMode,
  TemplateWithDetails,
  Variant,
} from "@/lib/types"
import { downloadTextFile, formatDecimalComma, sanitizeFilename } from "@/lib/utils"

interface ExportVariantsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templates: TemplateWithDetails[]
  mode: TemplateMode
  closedDifficulty: QuestionDifficulty
  closedOptionCount: number
  openDifficulty: QuestionDifficulty
}

interface QuestionRowState {
  included: boolean
  variantCount: number
  /** Raw percent (e.g. 42 for ±42%); undefined = use the batch preset. */
  customSpreadPercent?: number
}

// Mirrors src-tauri/src/engine/generator.rs's max_deviation_for_difficulty
// (closed) and sd_fraction_for_difficulty (open) tables — kept here only for
// this dialog's placeholder text. Purely cosmetic: never sent to the
// backend, which is always the source of truth for the actual value used.
//
// `very_hard` is an open-only tier (see `QuestionDifficulty`); the closed
// entry below is unreachable from the UI (no closed selector offers it) and
// exists only so this Record stays exhaustive over the shared type.
const CLOSED_SPREAD_PERCENT: Record<QuestionDifficulty, number> = {
  easy: 70,
  medium: 50,
  hard: 30,
  very_hard: 30,
}
const OPEN_SPREAD_PERCENT: Record<QuestionDifficulty, number> = {
  easy: 50,
  medium: 30,
  hard: 10,
  very_hard: 5,
}

function defaultSpreadPercentFor(mode: TemplateMode, difficulty: QuestionDifficulty): number {
  return mode === "closed" ? CLOSED_SPREAD_PERCENT[difficulty] : OPEN_SPREAD_PERCENT[difficulty]
}

export function ExportVariantsDialog({
  open,
  onOpenChange,
  templates,
  mode,
  closedDifficulty,
  closedOptionCount,
  openDifficulty,
}: ExportVariantsDialogProps) {
  const { toast } = useToast()
  const [isExporting, setIsExporting] = useState(false)
  const [isLoadingSamples, setIsLoadingSamples] = useState(false)
  const [sampleVariants, setSampleVariants] = useState<Record<string, Variant>>({})
  const [filename, setFilename] = useState("")

  // State for each question row: included status and variant count
  const [rowStates, setRowStates] = useState<Record<string, QuestionRowState>>(() => {
    const initial: Record<string, QuestionRowState> = {}
    for (const t of templates) {
      initial[t.template.id] = { included: true, variantCount: 1 }
    }
    return initial
  })

  // Update row states when templates change (e.g. navigating to another set)
  useEffect(() => {
    if (templates.length === 0) return
    setRowStates((prev) => {
      const newStates: Record<string, QuestionRowState> = {}
      for (const t of templates) {
        newStates[t.template.id] = prev[t.template.id] ?? { included: true, variantCount: 1 }
      }
      return newStates
    })
  }, [templates])

  // Generate one random sample variant per template whenever the dialog opens
  useEffect(() => {
    if (!open || templates.length === 0) return

    const today = new Date().toISOString().slice(0, 10)
    setFilename(`export-${today}`)

    let cancelled = false
    setIsLoadingSamples(true)

    void generationApi
      .generateForTemplates({
        templateIds: templates.map((t) => t.template.id),
        count: 1,
        baseSeed: Date.now(),
        mode,
        difficulty: mode === "closed" ? closedDifficulty : openDifficulty,
        optionCount: mode === "closed" ? closedOptionCount : 5,
      })
      .then((results) => {
        if (cancelled) return
        const samples: Record<string, Variant> = {}
        for (const result of results) {
          if (result.variants[0]) {
            samples[result.template.id] = result.variants[0]
          }
        }
        setSampleVariants(samples)
      })
      .catch((err) => {
        if (cancelled) return
        toast({
          title: cs.sets.exportDialog.errorTitle,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        })
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSamples(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, templates, mode, closedDifficulty, closedOptionCount, openDifficulty, toast])

  const includedTemplates = useMemo(() => {
    return templates.filter((t) => rowStates[t.template.id]?.included !== false)
  }, [templates, rowStates])

  const totalVariants = useMemo(() => {
    return includedTemplates.reduce(
      (sum: number, t: TemplateWithDetails) =>
        sum + Math.max(0, Math.min(100000, rowStates[t.template.id]?.variantCount ?? 0)),
      0,
    )
  }, [includedTemplates, rowStates])

  const handleToggleInclude = useCallback((templateId: string) => {
    setRowStates((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        included: !prev[templateId]?.included,
      },
    }))
  }, [])

  const handleVariantCountChange = useCallback((templateId: string, value: string) => {
    const num = parseInt(value, 10)
    const validated = Number.isNaN(num) || num < 0 ? 0 : Math.min(100000, num)
    setRowStates((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        variantCount: validated,
      },
    }))
  }, [])

  const handleSpreadPercentChange = useCallback((templateId: string, value: number | undefined) => {
    // Blank, non-finite, zero, or negative all mean "no override" — falls
    // back to the batch preset, matching the backend's own fallback logic.
    const validated =
      value !== undefined && Number.isFinite(value) && value > 0 ? Math.min(999, value) : undefined
    setRowStates((prev) => ({
      ...prev,
      [templateId]: {
        ...prev[templateId],
        customSpreadPercent: validated,
      },
    }))
  }, [])

  const handleExport = useCallback(async () => {
    if (includedTemplates.length === 0) {
      toast({
        title: cs.sets.exportDialog.noQuestions,
        variant: "destructive",
      })
      return
    }

    setIsExporting(true)

    try {
      // Generate variants for each included template
      const exportQuestions: ExportQuestion[] = []

      for (let i = 0; i < includedTemplates.length; i++) {
        const templateDetails = includedTemplates[i]
        const count = Math.max(
          0,
          Math.min(100000, rowStates[templateDetails.template.id]?.variantCount ?? 0),
        )

        if (count === 0) continue

        // Generate variants for this template
        const result = await generationApi.generateForTemplates({
          templateIds: [templateDetails.template.id],
          count,
          baseSeed: Date.now() + i,
          mode,
          difficulty: mode === "closed" ? closedDifficulty : openDifficulty,
          optionCount: mode === "closed" ? closedOptionCount : 5,
          customSpreadPercent: rowStates[templateDetails.template.id]?.customSpreadPercent,
        })

        const templateResult = result[0]
        if (!templateResult) continue

        // Build ExportQuestion for each variant
        for (const variant of templateResult.variants) {
          const variablePrecisions: Record<string, number> = {}
          const variableSignificantDigits: Record<string, number> = {}
          const variableNotations: Record<string, Notation> = {}
          for (const v of templateDetails.variables) {
            variablePrecisions[v.variable.symbol] = v.variable.precision
            if (v.variable.significantDigits) {
              variableSignificantDigits[v.variable.symbol] = v.variable.significantDigits
            }
            if (v.variable.notation && v.variable.notation !== "auto") {
              variableNotations[v.variable.symbol] = v.variable.notation
            }
          }

          exportQuestions.push({
            template: templateDetails.template,
            variant,
            variablePrecisions,
            variableSignificantDigits,
            variableNotations:
              Object.keys(variableNotations).length > 0 ? variableNotations : undefined,
            resultPrecision: 2,
            resultSignificantDigits: templateDetails.template.significantDigits,
            forceScientific: templateDetails.template.forceScientific ?? false,
            mode,
          })
        }
      }

      if (exportQuestions.length === 0) {
        toast({
          title: cs.sets.exportDialog.noVariants,
          variant: "destructive",
        })
        return
      }

      // Export to text file
      const rawName = sanitizeFilename(filename) || `export-${Date.now()}`
      const result = await generationApi.exportToTxt({
        filename: rawName,
        questions: exportQuestions,
      })

      downloadTextFile(`${rawName}.txt`, result.content)

      toast({
        title: cs.sets.exportDialog.successTitle,
        description: cs.sets.exportDialog.successDescription.replace("{filePath}", result.filePath),
      })

      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast({
        title: cs.sets.exportDialog.errorTitle,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }, [
    includedTemplates,
    rowStates,
    mode,
    closedDifficulty,
    closedOptionCount,
    openDifficulty,
    toast,
    onOpenChange,
    filename,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{cs.sets.exportDialog.title}</DialogTitle>
          <DialogDescription>
            {cs.sets.exportDialog.description?.replace("{count}", String(templates.length))}
          </DialogDescription>
          {isLoadingSamples && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
              <Loader2 className="size-4 animate-spin" />
              {cs.sets.exportDialog.loadingSamples}
            </div>
          )}
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="export-filename">{cs.sets.exportDialog.filenameLabel}</Label>
            <Input
              id="export-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder={cs.sets.exportDialog.filenamePlaceholder}
              disabled={isExporting}
            />
            <p className="text-xs text-muted-foreground">{cs.sets.exportDialog.filenameHelp}</p>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>{cs.sets.exportDialog.questionText}</TableHead>
                <TableHead className="w-[120px] text-right">
                  {cs.sets.exportDialog.variantCount}
                </TableHead>
                <TableHead className="w-[130px] text-right">
                  {cs.sets.exportDialog.spreadPercent}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((templateDetails, index) => {
                const state = rowStates[templateDetails.template.id] ?? {
                  included: true,
                  variantCount: 1,
                }
                const isIncluded = state.included
                const sdAllowed = templateDetails.constraint?.sdAllowed
                const hasSd = sdAllowed != null && Number.isFinite(sdAllowed) && sdAllowed > 0
                const constantsMap = Object.fromEntries(
                  templateDetails.constants.map((c) => [c.symbol, c.value]),
                )

                return (
                  <TableRow
                    key={templateDetails.template.id}
                    className={!isIncluded ? "opacity-50 bg-muted/30" : ""}
                    onClick={(e) => {
                      // Don't toggle if clicking on input
                      if ((e.target as HTMLElement).tagName === "INPUT") return
                      handleToggleInclude(templateDetails.template.id)
                    }}
                  >
                    <TableCell className="font-medium">{index + 1}</TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={isIncluded}
                        onChange={() => handleToggleInclude(templateDetails.template.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4"
                        aria-label={
                          isIncluded
                            ? cs.sets.exportDialog.excludeQuestion
                            : cs.sets.exportDialog.includeQuestion
                        }
                      />
                    </TableCell>
                    <TableCell className="min-w-[400px] max-w-2xl">
                      <QuestionTextRenderer
                        text={templateDetails.template.questionText}
                        variables={templateDetails.variables}
                        variant={sampleVariants[templateDetails.template.id]}
                        constants={constantsMap}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Input
                          type="number"
                          min={0}
                          max={100000}
                          value={state.variantCount === 0 ? "" : state.variantCount}
                          onChange={(e) =>
                            handleVariantCountChange(templateDetails.template.id, e.target.value)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="w-20 text-right no-spinner"
                          disabled={!isIncluded}
                          aria-label={cs.sets.exportDialog.variantCount}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <DecimalInput
                          value={state.customSpreadPercent ?? ""}
                          onValueChange={(v) =>
                            handleSpreadPercentChange(templateDetails.template.id, v)
                          }
                          onClick={(e) => e.stopPropagation()}
                          className="w-20 text-right no-spinner"
                          disabled={!isIncluded || hasSd}
                          placeholder={
                            hasSd
                              ? `SD ±${formatDecimalComma(String(sdAllowed))} %`
                              : String(
                                  defaultSpreadPercentFor(
                                    mode,
                                    mode === "closed" ? closedDifficulty : openDifficulty,
                                  ),
                                )
                          }
                          aria-label={cs.sets.exportDialog.spreadPercent}
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>

          <div className="text-sm text-muted-foreground">
            {cs.sets.exportDialog.totalVariants}: {totalVariants}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isExporting}>
            {cs.common.cancel}
          </Button>
          <Button onClick={handleExport} disabled={isExporting || includedTemplates.length === 0}>
            {isExporting ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {cs.sets.exportDialog.exporting}
              </>
            ) : (
              cs.sets.exportDialog.exportButton
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
