import { cva } from "class-variance-authority"
import { Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { DatabazeDialog } from "@/components/databaze/databaze-dialog"
import {
  type BulkImportEntry,
  MolarMassBulkImportDialog,
} from "@/components/databaze/molar-mass-bulk-import-dialog"
import { MolarMassDialog } from "@/components/databaze/molar-mass-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { UnitRenderer } from "@/components/ui/unit-renderer"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, constantsApi } from "@/lib/api"
import { formatAtomicWeight, isKnownElement } from "@/lib/periodic-table-data"
import type { Constant, DatabazeEntry } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useDatabazeActions, useDatabazeEntries } from "@/stores/databaze-store"

const pageContainerVariants = cva("space-y-6")

const entryCardVariants = cva("space-y-4")

const entryItemVariants = cva(
  "p-4 bg-muted/50 rounded-lg border border-border/20 hover:bg-muted/70 transition-colors duration-200",
)

const codeVariants = cva("font-mono text-sm bg-muted px-2 py-1 rounded")

const actionButtonVariants = cva("h-7 gap-1")

const MOLAR_MASS_UNIT = "g/mol"

type DatabazeTab = "variables" | "atomicWeights"

export function DatabazePage() {
  const { toast } = useToast()
  const entries = useDatabazeEntries()
  const { addEntry, updateEntry, deleteEntry } = useDatabazeActions()

  const [activeTab, setActiveTab] = useState<DatabazeTab>("variables")

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEntry, setEditingEntry] = useState<DatabazeEntry | null>(null)

  const [molarMasses, setMolarMasses] = useState<Constant[]>([])
  const [isLoadingMolarMasses, setIsLoadingMolarMasses] = useState(true)
  const [molarMassDialogOpen, setMolarMassDialogOpen] = useState(false)
  const [editingMolarMass, setEditingMolarMass] = useState<Constant | null>(null)
  const [bulkImportDialogOpen, setBulkImportDialogOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [showAtomicWeights, setShowAtomicWeights] = useState(false)

  const handleAddNew = useCallback(() => {
    setEditingEntry(null)
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((entry: DatabazeEntry) => {
    setEditingEntry(entry)
    setDialogOpen(true)
  }, [])

  const handleDelete = useCallback(
    (entry: DatabazeEntry) => {
      const confirmed = confirm(cs.databaze.deleteConfirm.replace("{code}", entry.code))
      if (confirmed) {
        deleteEntry(entry.id)
      }
    },
    [deleteEntry],
  )

  const handleSubmit = useCallback(
    (data: Omit<DatabazeEntry, "id" | "createdAt">) => {
      if (editingEntry) {
        updateEntry(editingEntry.id, data)
      } else {
        addEntry(data)
      }
      setDialogOpen(false)
      setEditingEntry(null)
    },
    [addEntry, updateEntry, editingEntry],
  )

  const existingCodes = useMemo(
    () => entries.filter((e) => e.id !== editingEntry?.id).map((e) => e.code),
    [entries, editingEntry],
  )

  const fetchMolarMasses = useCallback(async () => {
    try {
      setIsLoadingMolarMasses(true)
      const allConstants = await constantsApi.list()
      setMolarMasses(allConstants.filter((c) => c.unit === MOLAR_MASS_UNIT && !c.isBuiltin))
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.databaze.atomicWeights.title,
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoadingMolarMasses(false)
    }
  }, [toast])

  useEffect(() => {
    fetchMolarMasses()
  }, [fetchMolarMasses])

  useEffect(() => {
    if (activeTab === "atomicWeights") {
      fetchMolarMasses()
    }
  }, [activeTab, fetchMolarMasses])

  const handleAddMolarMass = useCallback(() => {
    setEditingMolarMass(null)
    setMolarMassDialogOpen(true)
  }, [])

  const handleEditMolarMass = useCallback((entry: Constant) => {
    setEditingMolarMass(entry)
    setMolarMassDialogOpen(true)
  }, [])

  const handleDeleteMolarMass = useCallback(
    async (entry: Constant) => {
      const confirmed = confirm(
        cs.databaze.atomicWeights.deleteConfirm.replace("{code}", entry.symbol),
      )
      if (!confirmed) return
      try {
        await constantsApi.delete(entry.id)
        await fetchMolarMasses()
        toast({
          title: cs.toasts.success.deleted.replace("{type}", cs.databaze.atomicWeights.title),
          description: `${entry.symbol} byla smazána.`,
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: cs.toasts.error.deleteFailed.replace("{type}", cs.databaze.atomicWeights.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchMolarMasses, toast],
  )

  const handleSubmitMolarMass = useCallback(
    async (data: { symbol: string; name: string; formula: string; value: number }) => {
      try {
        if (editingMolarMass) {
          await constantsApi.update(editingMolarMass.id, {
            name: data.name || data.symbol,
            symbol: data.symbol,
            value: data.value,
            unit: MOLAR_MASS_UNIT,
            formula: data.formula || data.symbol,
          })
        } else {
          await constantsApi.create({
            name: data.name || data.symbol,
            symbol: data.symbol,
            value: data.value,
            unit: MOLAR_MASS_UNIT,
            formula: data.formula || data.symbol,
          })
        }
        await fetchMolarMasses()
        setMolarMassDialogOpen(false)
        setEditingMolarMass(null)
        toast({
          title: cs.toasts.info.saved,
          description: `${data.symbol} = ${formatAtomicWeight(data.value)} ${MOLAR_MASS_UNIT}`,
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: cs.databaze.atomicWeights.title,
          description: message,
          variant: "destructive",
        })
      }
    },
    [editingMolarMass, fetchMolarMasses, toast],
  )

  const existingMolarMassSymbols = useMemo(
    () => molarMasses.filter((c) => c.id !== editingMolarMass?.id).map((c) => c.symbol),
    [molarMasses, editingMolarMass],
  )

  const molarMassesBySymbol = useMemo(
    () => new Map(molarMasses.map((c) => [c.symbol, c])),
    [molarMasses],
  )

  const atomicWeights = useMemo(() => {
    const weights: Record<string, number> = {}
    for (const c of molarMasses) {
      if (c.unit === MOLAR_MASS_UNIT) {
        weights[c.symbol] = c.value
      }
    }
    return weights
  }, [molarMasses])

  const isAtomicWeightEntry = useCallback((c: Constant) => {
    if (isKnownElement(c.symbol)) return true
    if (c.formula && isKnownElement(c.formula)) return true
    return false
  }, [])

  const filteredMolarMasses = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return molarMasses
      .filter((c) => showAtomicWeights || !isAtomicWeightEntry(c))
      .filter(
        (c) =>
          !query ||
          c.symbol.toLowerCase().includes(query) ||
          c.name.toLowerCase().includes(query) ||
          (c.formula?.toLowerCase().includes(query) ?? false),
      )
  }, [molarMasses, searchQuery, showAtomicWeights, isAtomicWeightEntry])

  const handleBulkImportMolarMasses = useCallback(
    async (entries: BulkImportEntry[]) => {
      if (entries.length === 0) {
        setBulkImportDialogOpen(false)
        return
      }

      try {
        await Promise.all(
          entries.map(async (entry) => {
            const existing = molarMassesBySymbol.get(entry.symbol)
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
        await fetchMolarMasses()
        setBulkImportDialogOpen(false)
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
      }
    },
    [fetchMolarMasses, molarMassesBySymbol, toast],
  )

  return (
    <div className={cn(pageContainerVariants())}>
      <div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.databaze.title}
          </h1>
          <p className="text-muted-foreground">{cs.databaze.pageDescription}</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-2 p-1 bg-muted rounded-lg">
          <Button
            variant={activeTab === "variables" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("variables")}
          >
            {cs.databaze.tabs.variables}
          </Button>
          <Button
            variant={activeTab === "atomicWeights" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("atomicWeights")}
          >
            {cs.databaze.tabs.atomicWeights}
          </Button>
        </div>

        {activeTab === "variables" ? (
          <Button onClick={handleAddNew} className={cn(actionButtonVariants())}>
            <Plus className="size-4 mr-2" />
            {cs.databaze.createEntry}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setBulkImportDialogOpen(true)}
              className={cn(actionButtonVariants())}
            >
              {cs.databaze.atomicWeights.bulkImport}
            </Button>
            <Button onClick={handleAddMolarMass} className={cn(actionButtonVariants())}>
              <Plus className="size-4 mr-2" />
              {cs.databaze.atomicWeights.createEntry}
            </Button>
          </div>
        )}
      </div>

      {activeTab === "variables" ? (
        <div>
          <Card>
            <CardHeader>
              <CardTitle>{cs.databaze.pageTitle}</CardTitle>
              <CardDescription>{cs.databaze.description}</CardDescription>
            </CardHeader>
            <CardContent className={cn(entryCardVariants())}>
              {entries.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-lg font-medium text-foreground">
                    {cs.databaze.emptyState.title}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    {cs.databaze.emptyState.description}
                  </p>
                  <Button onClick={handleAddNew} className="mt-4" variant="outline">
                    {cs.databaze.emptyState.cta}
                  </Button>
                </div>
              ) : (
                entries.map((entry) => (
                  <div key={entry.id} className={cn(entryItemVariants())}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-foreground text-lg">{entry.code}</h3>
                          <span className={cn(codeVariants())}>[[{entry.code}]]</span>
                        </div>
                        <p className="text-foreground-muted text-sm mt-2">
                          {entry.values.join(", ")}
                        </p>
                      </div>
                      <div className="flex gap-2 sm:mt-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEdit(entry)}
                          className={cn(actionButtonVariants())}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only sm:not-sr-only ml-1">{cs.common.edit}</span>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDelete(entry)}
                          className={cn(actionButtonVariants())}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only sm:not-sr-only ml-1">{cs.common.delete}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div>
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5">
                  <CardTitle>{cs.databaze.atomicWeights.title}</CardTitle>
                  <CardDescription>{cs.databaze.atomicWeights.description}</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={fetchMolarMasses}
                  disabled={isLoadingMolarMasses}
                  className={cn(actionButtonVariants())}
                >
                  <RefreshCw className={cn("size-3.5", isLoadingMolarMasses && "animate-spin")} />
                  <span className="sr-only">{cs.common.refresh}</span>
                </Button>
              </div>
            </CardHeader>
            <CardContent className={cn(entryCardVariants())}>
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <Input
                    placeholder={cs.databaze.atomicWeights.searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9"
                    disabled={isLoadingMolarMasses}
                  />
                </div>
                <Button
                  variant={showAtomicWeights ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowAtomicWeights((v) => !v)}
                  disabled={isLoadingMolarMasses}
                >
                  {cs.databaze.atomicWeights.showAtomicWeights}
                </Button>
              </div>
              {isLoadingMolarMasses ? (
                <div className="text-center py-12 text-muted-foreground">
                  {cs.common.loading}...
                </div>
              ) : filteredMolarMasses.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-lg font-medium text-foreground">
                    {molarMasses.length === 0
                      ? cs.databaze.atomicWeights.emptyState.title
                      : cs.databaze.atomicWeights.noSearchResults}
                  </p>
                  {molarMasses.length === 0 && (
                    <>
                      <p className="text-sm text-muted-foreground mt-2">
                        {cs.databaze.atomicWeights.emptyState.description}
                      </p>
                      <Button onClick={fetchMolarMasses} className="mt-4" variant="outline">
                        {cs.databaze.atomicWeights.emptyState.cta}
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                filteredMolarMasses.map((entry) => (
                  <div key={entry.id} className={cn(entryItemVariants())}>
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground text-lg">{entry.symbol}</h3>
                          {entry.name && entry.name !== entry.symbol && (
                            <span className={cn(codeVariants())}>{entry.name}</span>
                          )}
                          {entry.formula && entry.formula !== entry.symbol && (
                            <span className={cn(codeVariants())}>{entry.formula}</span>
                          )}
                          <span className={cn(codeVariants())}>
                            {formatAtomicWeight(entry.value)}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            <UnitRenderer unit={entry.unit} />
                          </span>
                        </div>
                        <p className="text-foreground-muted text-sm mt-2">
                          {cs.databaze.atomicWeights.columns.value}:{" "}
                          {formatAtomicWeight(entry.value)} <UnitRenderer unit={entry.unit} />
                        </p>
                      </div>
                      <div className="flex gap-2 sm:mt-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleEditMolarMass(entry)}
                          className={cn(actionButtonVariants())}
                        >
                          <Pencil className="size-3.5" />
                          <span className="sr-only sm:not-sr-only ml-1">{cs.common.edit}</span>
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteMolarMass(entry)}
                          className={cn(actionButtonVariants())}
                        >
                          <Trash2 className="size-3.5" />
                          <span className="sr-only sm:not-sr-only ml-1">{cs.common.delete}</span>
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <DatabazeDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setEditingEntry(null)
          }
        }}
        onSubmit={handleSubmit}
        title={editingEntry ? cs.databaze.editEntry : cs.databaze.createEntry}
        confirmText={editingEntry ? cs.common.save : cs.common.create}
        initialValues={
          editingEntry ? { code: editingEntry.code, values: editingEntry.values } : undefined
        }
        existingCodes={existingCodes}
      />

      <MolarMassDialog
        open={molarMassDialogOpen}
        onOpenChange={(open) => {
          setMolarMassDialogOpen(open)
          if (!open) {
            setEditingMolarMass(null)
          }
        }}
        onSubmit={handleSubmitMolarMass}
        title={
          editingMolarMass
            ? cs.databaze.atomicWeights.editEntry
            : cs.databaze.atomicWeights.createEntry
        }
        confirmText={editingMolarMass ? cs.common.save : cs.common.create}
        initialValues={
          editingMolarMass
            ? {
                symbol: editingMolarMass.symbol,
                name: editingMolarMass.name,
                formula:
                  editingMolarMass.formula ??
                  (isKnownElement(editingMolarMass.symbol)
                    ? editingMolarMass.symbol
                    : editingMolarMass.name),
                value: editingMolarMass.value,
              }
            : undefined
        }
        existingSymbols={existingMolarMassSymbols}
        atomicWeights={atomicWeights}
        readOnlySymbol={false}
      />

      <MolarMassBulkImportDialog
        open={bulkImportDialogOpen}
        onOpenChange={setBulkImportDialogOpen}
        onSubmit={handleBulkImportMolarMasses}
        atomicWeights={atomicWeights}
      />
    </div>
  )
}
