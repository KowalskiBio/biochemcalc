import { Download, Loader2, Upload } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, constantsApi, extractErrorMessage, topicsApi } from "@/lib/api"
import {
  pairFormulasWithQuestions,
  parseBulkImport,
  parseFormulaText,
} from "@/lib/bulk-import-parser"
import { describeFailedChecks, verifyExpectedAnswers } from "@/lib/bulk-import-verify"
import {
  MOLAR_MASS_UNIT,
  type BulkImportEntry as MolarMassBulkImportEntry,
  parseMolarMassBulkImport,
} from "@/lib/molar-mass-import-parser"
import { useDatabazeEntries } from "@/stores/databaze-store"

const sampleInput = `Hmotnostní a objemové procento, ředění
2 body
2_1
Jaký je hmotnostní zlomek [[sK]][[sA]] v roztoku, který vznikl rozpuštěním [[ms]] g této látky ve [[mv]] g vody? [w]
Jaký je hmotnostní zlomek [[KK]][[AA]] v roztoku, jehož [[mr]] g obsahuje [[ms]] g [[KK]][[AA]]? [w]
2_2
Kolik gramů [[molekula2]] je nutno rozpustit ve [[mv]] litrech vody, abychom získali [[wperc]] roztok? [ms]
3 body
3_1
Jaký je hmotnostní zlomek [[KK]][[AA]] v roztoku, který vznikl z [[m1]] g vodného roztoku [[KK]][[AA]], ve kterém byl w([[KK]][[AA]]) = [[w1]], bylo-li do soustavy přidáno [[m2]] g vody? [w2]
`

const sampleFormulaInput = `2_1
w = ms / (ms + mv)
w = ms / mr
2_2
wperc = ms / (ms + mv) × 100
3_1
w2 = m1 * w1 / (m1 + m2)`

type ImportMode = "questions" | "questions-and-formulas"

export function BulkImportPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const databazeEntries = useDatabazeEntries()
  const [inputText, setInputText] = useState("")
  const [formulaText, setFormulaText] = useState("")
  const [mode, setMode] = useState<ImportMode>("questions")
  const [parseError, setParseError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)

  const [molarMassText, setMolarMassText] = useState("")
  const [molarMassErrors, setMolarMassErrors] = useState<string[]>([])
  const [isImportingMolarMasses, setIsImportingMolarMasses] = useState(false)
  const [atomicWeights, setAtomicWeights] = useState<Record<string, number>>({})
  const [constantValues, setConstantValues] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const allConstants = await constantsApi.list()
        const weights: Record<string, number> = {}
        const values: Record<string, number> = {}
        for (const c of allConstants) {
          values[c.symbol] = c.value
          if (c.unit === MOLAR_MASS_UNIT) {
            weights[c.symbol] = c.value
          }
        }
        if (!cancelled) {
          setAtomicWeights(weights)
          setConstantValues(values)
        }
      } catch (error) {
        void error
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const parsedMolarMasses = useMemo(
    () => parseMolarMassBulkImport(molarMassText, atomicWeights),
    [atomicWeights, molarMassText],
  )

  const parseResult = useMemo(() => {
    if (!inputText.trim()) {
      setParseError(null)
      return null
    }
    try {
      const parsedQuestions = parseBulkImport(inputText, databazeEntries)
      if (mode === "questions") {
        setParseError(null)
        return parsedQuestions
      }
      const parsedFormulas = parseFormulaText(formulaText)
      const pairingResult = pairFormulasWithQuestions(parsedQuestions.data, parsedFormulas)
      setParseError(null)
      return {
        data: pairingResult.data,
        warnings: [...parsedQuestions.warnings, ...pairingResult.warnings],
      }
    } catch (err) {
      setParseError(extractErrorMessage(err, "Failed to parse import text"))
      return null
    }
  }, [inputText, formulaText, mode, databazeEntries])

  const parsedData = parseResult?.data ?? null
  const pairingWarnings = parseResult?.warnings ?? []

  // Questions that state a known answer are checked against their formula, so a
  // mispaired or mistyped equation is caught before anything is written.
  const answerCheckWarnings = useMemo(() => {
    if (!parsedData) return []
    return describeFailedChecks(verifyExpectedAnswers(parsedData, constantValues))
  }, [parsedData, constantValues])

  const totalQuestions = useMemo(() => {
    if (!parsedData) return 0
    return parsedData.categories.reduce(
      (acc, category) => acc + category.sets.reduce((s, set) => s + set.questions.length, 0),
      0,
    )
  }, [parsedData])

  const getPairingStatus = useCallback((set: { questions: { formula: string }[] }) => {
    const pairedCount = set.questions.filter((q) => q.formula && q.formula.trim() !== "").length
    return { paired: pairedCount, total: set.questions.length }
  }, [])

  const handleImport = useCallback(async () => {
    if (!parsedData) return

    try {
      setIsImporting(true)
      const topic = await topicsApi.importBulk(parsedData)
      toast({
        title: cs.bulkImport.success,
        description: cs.bulkImport.successDescription
          .replace("{topic}", topic.name)
          .replace("{count}", String(totalQuestions)),
      })
      navigate(`/topics/${topic.id}`)
    } catch (err) {
      const message = extractErrorMessage(err, cs.bulkImport.error)
      toast({
        title: cs.bulkImport.error,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsImporting(false)
    }
  }, [parsedData, totalQuestions, navigate, toast])

  const loadSample = useCallback(() => {
    setInputText(sampleInput.trim())
    if (mode === "questions-and-formulas") {
      setFormulaText(sampleFormulaInput.trim())
    } else {
      setFormulaText("")
    }
  }, [mode])

  const handleImportMolarMasses = useCallback(
    async (entries: MolarMassBulkImportEntry[]) => {
      if (entries.length === 0) return

      try {
        setIsImportingMolarMasses(true)
        const allConstants = await constantsApi.list()
        const existingBySymbol = new Map(
          allConstants
            .filter((c) => c.unit === MOLAR_MASS_UNIT && !c.isBuiltin)
            .map((c) => [c.symbol, c]),
        )

        await Promise.all(
          entries.map(async (entry) => {
            const existing = existingBySymbol.get(entry.symbol)
            if (existing) {
              await constantsApi.update(existing.id, {
                name: entry.formula || entry.symbol,
                symbol: entry.symbol,
                value: entry.value,
                unit: MOLAR_MASS_UNIT,
                formula: entry.formula || entry.symbol,
              })
            } else {
              await constantsApi.create({
                name: entry.formula || entry.symbol,
                symbol: entry.symbol,
                value: entry.value,
                unit: MOLAR_MASS_UNIT,
                formula: entry.formula || entry.symbol,
              })
            }
          }),
        )

        setMolarMassText("")
        setMolarMassErrors([])
        toast({
          title: cs.databaze.atomicWeights.title,
          description: cs.databaze.atomicWeights.bulkImportSuccess.replace(
            "{count}",
            String(entries.length),
          ),
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: cs.databaze.atomicWeights.title,
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsImportingMolarMasses(false)
      }
    },
    [toast],
  )

  const handleSubmitMolarMasses = useCallback(() => {
    const { entries, errors: parseErrors } = parsedMolarMasses
    if (parseErrors.length > 0) {
      setMolarMassErrors(parseErrors)
      return
    }
    setMolarMassErrors([])
    handleImportMolarMasses(entries)
  }, [handleImportMolarMasses, parsedMolarMasses])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cs.bulkImport.title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{cs.bulkImport.description}</p>
          </div>
          <Button variant="outline" onClick={loadSample}>
            <Download className="size-4 mr-2" />
            {cs.bulkImport.loadSample}
          </Button>
        </div>
      </div>

       <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{cs.bulkImport.inputTitle}</CardTitle>
            <CardDescription>{cs.bulkImport.inputDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-import-mode">{cs.bulkImport.modeLabel}</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as ImportMode)}>
                <SelectTrigger id="bulk-import-mode" className="w-full">
                  <SelectValue placeholder={cs.bulkImport.modeLabel} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="questions">{cs.bulkImport.modeQuestionsOnly}</SelectItem>
                  <SelectItem value="questions-and-formulas">
                    {cs.bulkImport.modeQuestionsAndFormulas}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bulk-import-text">{cs.bulkImport.textLabel}</Label>
              <Textarea
                id="bulk-import-text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={cs.bulkImport.placeholder}
                className="min-h-[200px] font-mono text-sm"
              />
            </div>

            {mode === "questions-and-formulas" && (
              <div className="space-y-2">
                <Label htmlFor="bulk-import-formulas">{cs.bulkImport.formulasLabel}</Label>
                <CardDescription className="mb-2">
                  {cs.bulkImport.formulasDescription}
                </CardDescription>
                <Textarea
                  id="bulk-import-formulas"
                  value={formulaText}
                  onChange={(e) => setFormulaText(e.target.value)}
                  placeholder={cs.bulkImport.formulasPlaceholder}
                  className="min-h-[200px] font-mono text-sm"
                />
              </div>
            )}

            {parseError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-md text-sm text-red-800 dark:text-red-200">
                <p className="font-medium">{cs.bulkImport.parseErrorTitle}</p>
                <p className="text-red-700 dark:text-red-300">{parseError}</p>
              </div>
            )}

            <Button
              onClick={handleImport}
              disabled={!parsedData || parsedData.categories.length === 0 || isImporting}
              className="w-full"
            >
              {isImporting ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Upload className="size-4 mr-2" />
              )}
              {isImporting ? cs.bulkImport.importing : cs.bulkImport.import}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{cs.bulkImport.previewTitle}</CardTitle>
            <CardDescription>
              {parsedData
                ? cs.bulkImport.previewDescription
                    .replace("{questions}", String(totalQuestions))
                    .replace("{categories}", String(parsedData.categories.length))
                : cs.bulkImport.noPreview}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {parsedData && pairingWarnings.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md">
                <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                  {cs.bulkImport.warningsHeader}
                </p>
                <ul className="text-sm text-amber-700 dark:text-amber-300">
                  {pairingWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {parsedData && answerCheckWarnings.length > 0 && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
                <p className="font-medium text-red-800 dark:text-red-200 mb-1">
                  {cs.bulkImport.answerCheckHeader}
                </p>
                <ul className="text-sm text-red-700 dark:text-red-300">
                  {answerCheckWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            {!parsedData ? (
              <div className="text-center py-12 text-muted-foreground">
                {cs.bulkImport.noPreview}
              </div>
            ) : (
              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                {parsedData.categories.map((category) => (
                  <div key={category.pointValue} className="space-y-2">
                    <h3 className="font-medium text-foreground">
                      {cs.topics.pointValue.replace("{value}", String(category.pointValue))}
                    </h3>
                    {category.sets.map((set) => {
                      const pairingStatus = getPairingStatus(set)
                      return (
                        <div
                          key={`${category.pointValue}-${set.setIndex}`}
                          className="pl-4 border-l-2 border-muted"
                        >
                           <div className="flex items-center gap-2 mb-1">
                             <p className="text-sm text-muted-foreground">
                               {cs.topics.setIndex.replace("{index}", String(set.setIndex))} ·{" "}
                               <span className="font-mono tabular">{set.questions.length}</span>{" "}
                               {set.questions.length === 1
                                 ? "otázka"
                                 : set.questions.length >= 2 && set.questions.length <= 4
                                   ? "otázky"
                                   : "otázek"}
                             </p>
                             {mode === "questions-and-formulas" && (
                               <span
                                 className={`text-xs px-2 py-0.5 rounded-full ${
                                   pairingStatus.paired === pairingStatus.total
                                     ? "bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-200"
                                     : "bg-amber-100 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200"
                                 }`}
                               >
                                 {cs.bulkImport.pairingStatus
                                   .replace("{paired}", String(pairingStatus.paired))
                                   .replace("{total}", String(pairingStatus.total))}
                               </span>
                             )}
                          </div>
                           <ul className="space-y-1">
                             {set.questions.map((question, idx) => (
                               <li
                                 key={`${category.pointValue}-${set.setIndex}-${question.questionText}`}
                                 className="text-sm text-muted-foreground truncate"
                                 title={question.questionText}
                               >
                                 <span className="font-mono tabular">{idx + 1}</span>. {question.questionText.slice(0, 80)}
                                 {question.questionText.length > 80 ? "…" : ""}
                                 {question.formula && mode === "questions-and-formulas" && (
                                   <span className="ml-2 text-xs text-muted-foreground">
                                     ({question.equationText})
                                   </span>
                                 )}
                               </li>
                             ))}
                           </ul>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
       </div>

       <div>
        <Card>
          <CardHeader>
            <CardTitle>{cs.databaze.atomicWeights.bulkImportTitle}</CardTitle>
            <CardDescription>{cs.databaze.atomicWeights.bulkImportDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-import-molar-masses">
                {cs.databaze.atomicWeights.bulkImportTitle}
              </Label>
              <Textarea
                id="bulk-import-molar-masses"
                value={molarMassText}
                onChange={(e) => setMolarMassText(e.target.value)}
                placeholder={cs.databaze.atomicWeights.bulkImportPlaceholder}
                className="min-h-[200px] font-mono text-sm"
              />
            </div>

            {molarMassErrors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-destructive">
                  {cs.databaze.atomicWeights.bulkImportErrors}
                </p>
                <ul className="text-sm text-destructive space-y-1 list-disc pl-4">
                  {molarMassErrors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            <Button
              onClick={handleSubmitMolarMasses}
              disabled={
                molarMassText.trim().length === 0 ||
                parsedMolarMasses.errors.length > 0 ||
                isImportingMolarMasses
              }
              className="w-full"
            >
              {isImportingMolarMasses ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Upload className="size-4 mr-2" />
              )}
              {isImportingMolarMasses
                ? cs.bulkImport.importing
                : cs.databaze.atomicWeights.bulkImport}
            </Button>
          </CardContent>
         </Card>
       </div>
     </div>
  )
}
