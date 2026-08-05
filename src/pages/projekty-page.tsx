import { Download, FolderOpen, Loader2, MoreVertical, Pencil, Save, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"
import { useToast } from "@/hooks/use-toast"
import { ApiError, projektyApi } from "@/lib/api"
import type { Projekt, ProjektContent, ProjektQuestion, UpdateProjektInput } from "@/lib/types"

export function ProjektyPage() {
  const { toast } = useToast()
  const [projekty, setProjekty] = useState<Projekt[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState<string | null>(null)
  const [editingProjekt, setEditingProjekt] = useState<Projekt | null>(null)
  const [projektContent, setProjektContent] = useState<ProjektContent | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [projektToDelete, setProjektToDelete] = useState<Projekt | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const fetchProjekty = useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await projektyApi.list()
      setProjekty(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const loadProjektContent = useCallback(
    async (projektId: string) => {
      try {
        setIsLoadingContent(true)
        const content = await projektyApi.load(projektId)
        setProjektContent(content)
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsLoadingContent(false)
      }
    },
    [toast],
  )

  const handleEdit = useCallback(
    async (projekt: Projekt) => {
      setEditingProjekt(projekt)
      await loadProjektContent(projekt.id)
    },
    [loadProjektContent],
  )

  const handleCancelEdit = useCallback(() => {
    setEditingProjekt(null)
    setProjektContent(null)
  }, [])

  const handleSaveProjekt = useCallback(async () => {
    if (!editingProjekt || !projektContent) return

    try {
      setIsSaving(true)
      const payload: UpdateProjektInput = {
        projektId: editingProjekt.id,
        name: editingProjekt.name,
        topicName: editingProjekt.topicName,
        mode: editingProjekt.mode,
        questions: projektContent.questions,
      }
      await projektyApi.update(payload)
      toast({
        title: "Projekt uložen",
        description: `Projekt "${editingProjekt.name}" byl úspěšně uložen.`,
      })
      await fetchProjekty()
      handleCancelEdit()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }, [editingProjekt, projektContent, fetchProjekty, handleCancelEdit, toast])

  // biome-ignore lint/correctness/useExhaustiveDependencies: functional update doesn't depend on projektContent closure
  const handleQuestionChange = useCallback(
    (
      index: number,
      field: keyof ProjektQuestion,
      value: string | number | Record<string, unknown> | Record<string, string> | undefined,
    ) => {
      if (!projektContent) return

      setProjektContent((prev) => {
        if (!prev) return null
        const updatedQuestions = [...prev.questions]
        const question = { ...updatedQuestions[index] }

        switch (field) {
          case "correctAnswer":
          case "seed":
          case "pointValue":
            question[field] = Number(value) as never
            break
          case "assignedValues":
            question.assignedValues = value as Record<string, unknown>
            break
          case "assignedStrings":
            question.assignedStrings = value as Record<string, string>
            break
          case "questionText":
          case "resultUnit":
            question[field] = String(value) as never
            break
          default:
            ;(question as Record<string, unknown>)[field as string] = value
        }

        updatedQuestions[index] = question
        return { ...prev, questions: updatedQuestions }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    fetchProjekty()
  }, [fetchProjekty])

  const openDeleteDialog = useCallback((projekt: Projekt) => {
    setProjektToDelete(projekt)
    setIsDeleteDialogOpen(true)
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!projektToDelete) return
    const { id, name } = projektToDelete
    try {
      setIsDeleting(id)
      await projektyApi.delete(id)
      toast({
        title: "Projekt smazán",
        description: `Projekt "${name}" byl úspěšně smazán.`,
      })
      await fetchProjekty()
      setIsDeleteDialogOpen(false)
      setProjektToDelete(null)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsDeleting(null)
    }
  }, [fetchProjekty, projektToDelete, toast])

  const handleExport = useCallback(
    async (projektId: string, name: string) => {
      try {
        setIsExporting(projektId)
        const result = await projektyApi.exportToTxt({
          projektId,
          filename: `projekt-${name.replace(/\s+/g, "-")}-${Date.now()}`,
        })
        toast({
          title: "Export dokončen",
          description: `Projekt byl exportován: ${result.filePath}`,
        })
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba exportu",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsExporting(null)
      }
    },
    [toast],
  )

  const modeLabel = (m: "closed" | "open") => (m === "closed" ? "Uzavřený" : "Otevřený")

  return (
    <>
      <div
        className="space-y-6"
      >
        <div
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projekty</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Správa uložených projektů s generovanými úkoly
              </p>
            </div>
          </div>
        </div>

        <div
        >
          {isLoading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <Loader2 className="size-8 animate-spin mx-auto mb-2" />
                <p className="text-foreground-muted">Načítám projekty...</p>
              </CardContent>
            </Card>
          ) : projekty.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <FolderOpen className="size-12 text-foreground-muted mx-auto mb-4" />
                <p className="text-muted-foreground mb-2">
                  Zatím jste nevytvořili žádné projekty.
                </p>
                <p className="text-muted-foreground text-sm mb-4">
                  Uložte generované úkoly z detailu sady pomocí "Uložit do Projektu"
                </p>
                <Button asChild variant="outline">
                  <Link to="/topics">Zpět na témata</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Seznam projektů</CardTitle>
                <CardDescription>
                  {projekty.length} uložen
                  {projekty.length === 1
                    ? "ý"
                    : projekty.length >= 2 && projekty.length <= 4
                      ? "é"
                      : "ých"}{" "}
                  projektů
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Název</TableHead>
                      <TableHead>Režim</TableHead>
                      <TableHead>Počet otázek</TableHead>
                      <TableHead>Téma</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead className="w-[80px]">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projekty.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <FolderOpen className="size-4 text-primary" />
                            {p.name}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={p.mode === "closed" ? "secondary" : "default"}>
                            {modeLabel(p.mode)}
                          </Badge>
                        </TableCell>
                        <TableCell>{p.questionCount}</TableCell>
                        <TableCell>{p.topicName || "—"}</TableCell>
                        <TableCell>{new Date(p.createdAt).toLocaleDateString("cs-CZ")}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="size-8 p-0">
                                <span className="sr-only">Akce</span>
                                <MoreVertical className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => handleEdit(p)}>
                                <Pencil className="size-4 mr-2" />
                                Upravit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleExport(p.id, p.name)}
                                disabled={isExporting === p.id}
                              >
                                <Download className="size-4 mr-2" />
                                Exportovat
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openDeleteDialog(p)}
                                disabled={isDeleting === p.id}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="size-4 mr-2" />
                                Smazat
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      <Dialog open={!!editingProjekt} onOpenChange={(open) => !open && handleCancelEdit()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Upravit projekt: {editingProjekt?.name}</DialogTitle>
          </DialogHeader>

          {isLoadingContent ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-8 animate-spin" />
              <span className="ml-2">Načítám obsah projektu...</span>
            </div>
          ) : projektContent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upravte otázky v tomto projektu. Změny budou uloženy při kliknutí na "Uložit".
              </p>

              <Separator />

              <div className="space-y-6">
                {projektContent.questions.map((question, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: templateId + seed is unique enough
                  <Card key={`${question.templateId}-${question.seed}-${index}`}>
                    <CardHeader>
                      <CardTitle className="text-lg">Otázka {index + 1}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Text otázky</Label>
                        <Textarea
                          value={question.questionText}
                          onChange={(e) =>
                            handleQuestionChange(index, "questionText", e.target.value)
                          }
                          rows={3}
                          className="min-h-[80px]"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Správná odpověď</Label>
                        {question.answersData && question.answersData.length > 0 ? (
                          <div className="space-y-2">
                            {question.answersData.map((a) => (
                              <div key={a.symbol} className="flex items-center gap-2">
                                <span className="text-sm font-medium min-w-[2rem]">
                                  {a.symbol} =
                                </span>
                                <Input
                                  type="number"
                                  value={a.value}
                                  readOnly
                                  className="w-full bg-muted/50"
                                />
                                {a.unit && (
                                  <span className="text-sm text-muted-foreground">{a.unit}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Input
                            type="number"
                            value={question.correctAnswer ?? ""}
                            onChange={(e) =>
                              handleQuestionChange(
                                index,
                                "correctAnswer",
                                e.target.value ? Number(e.target.value) : 0,
                              )
                            }
                            className="w-full"
                          />
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>Přiřazené číselné hodnoty</Label>
                        {Object.entries(question.assignedValues).length > 0 ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Object.entries(question.assignedValues).map(([key, value]) => (
                              <div key={key} className="space-y-1">
                                <Label className="text-xs">{key}</Label>
                                <Input
                                  type="number"
                                  value={typeof value === "number" ? value : 0}
                                  onChange={(e) => {
                                    const newValues = { ...question.assignedValues }
                                    newValues[key] = Number(e.target.value)
                                    handleQuestionChange(index, "assignedValues", newValues)
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Žádné číselné proměnné
                          </p>
                        )}
                      </div>

                      {question.assignedStrings &&
                        Object.keys(question.assignedStrings).length > 0 && (
                          <div className="space-y-2">
                            <Label>Přiřazené textové hodnoty</Label>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {Object.entries(question.assignedStrings).map(([key, value]) => (
                                <div key={key} className="space-y-1">
                                  <Label className="text-xs">{key}</Label>
                                  <Input
                                    value={value}
                                    onChange={(e) => {
                                      const newStrings = { ...(question.assignedStrings || {}) }
                                      newStrings[key] = e.target.value
                                      handleQuestionChange(index, "assignedStrings", newStrings)
                                    }}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={handleCancelEdit} disabled={isSaving}>
              <X className="size-4 mr-2" />
              Zrušit
            </Button>
            <Button onClick={handleSaveProjekt} disabled={isSaving || !projektContent}>
              {isSaving ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Save className="size-4 mr-2" />
              )}
              Uložit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {projektToDelete && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={handleConfirmDelete}
          title="Smazat projekt"
          description={`Opravdu chcete smazat projekt "${projektToDelete.name}"? Tato akce nelze vrátit zpět.`}
        />
      )}
    </>
  )
}
