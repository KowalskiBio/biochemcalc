import { Lock, Plus, Unlock, X } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
// Import shadcn/ui components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
// Import hooks
import { useToast } from "@/hooks/use-toast"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { categoriesApi, templatesApi } from "@/lib/api"
import type { Set as AppSet, Category, Template } from "@/lib/types"

interface TemplateAssignmentProps {
  category: Category
  onNext: (setsWithTemplates: Map<string, string[]>) => void
  onBack: () => void
}

export function TemplateAssignment({ category, onNext, onBack }: TemplateAssignmentProps) {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [categorySets, setCategorySets] = useState<AppSet[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Template assignments: Map setId -> templateIds
  const [templateAssignments, setTemplateAssignments] = useState<Map<string, string[]>>(new Map())

  // Available templates grouped by mode
  const [availableTemplates, setAvailableTemplates] = useState<{
    closed: Template[]
    open: Template[]
    all: Template[]
  }>({ closed: [], open: [], all: [] })

  // Selected template for adding
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("")
  const [selectedSetId, setSelectedSetId] = useState<string>("")

  // Fetch templates and category with sets
  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)
      const [templatesData, categoryWithSets] = await Promise.all([
        templatesApi.list(),
        categoriesApi.getWithSets(category.id),
      ])

      setTemplates(templatesData)
      setCategorySets(categoryWithSets.sets)

      // Group templates by mode
      const closedTemplates = templatesData.filter((t) => t.mode === "closed")
      const openTemplates = templatesData.filter((t) => t.mode === "open")
      setAvailableTemplates({
        closed: closedTemplates,
        open: openTemplates,
        all: templatesData,
      })
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load data",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [category.id, toast])

  // Initialize template assignments
  useEffect(() => {
    if (categorySets.length > 0) {
      const initialAssignments = new Map<string, string[]>()
      categorySets.forEach((set) => {
        initialAssignments.set(set.id, [])
      })
      setTemplateAssignments(initialAssignments)
    }
  }, [categorySets])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleAddTemplateToSet = useCallback(() => {
    if (!selectedSetId || !selectedTemplateId) return

    const template = templates.find((t) => t.id === selectedTemplateId)
    if (!template) return

    const set = categorySets.find((s) => s.id === selectedSetId)
    if (!set) return

    // Check if template mode matches set mode
    if (template.mode !== set.mode) {
      toast({
        title: "Error",
        description: `Cannot add ${template.mode} template to ${set.mode} set`,
        variant: "destructive",
      })
      return
    }

    // Add template to set
    const currentAssignments = templateAssignments.get(selectedSetId) ?? []
    if (!currentAssignments.includes(selectedTemplateId)) {
      const updatedAssignments = new Map(templateAssignments)
      updatedAssignments.set(selectedSetId, [...currentAssignments, selectedTemplateId])
      setTemplateAssignments(updatedAssignments)
    }

    setSelectedTemplateId("")
    setSelectedSetId("")
  }, [templates, categorySets, templateAssignments, toast, selectedTemplateId, selectedSetId])

  const handleRemoveTemplateFromSet = useCallback(
    (setId: string, templateId: string) => {
      const currentAssignments = templateAssignments.get(setId) ?? []
      const updatedAssignments = new Map(templateAssignments)
      updatedAssignments.set(
        setId,
        currentAssignments.filter((id) => id !== templateId),
      )
      setTemplateAssignments(updatedAssignments)
    },
    [templateAssignments],
  )

  const handleContinue = useCallback(() => {
    // Validate that each set has at least one template
    for (const [setId, templateIds] of templateAssignments) {
      if (templateIds.length === 0) {
        toast({
          title: "Error",
          description: `Set ${setId} must have at least one template`,
          variant: "destructive",
        })
        return
      }
    }

    onNext(templateAssignments)
  }, [templateAssignments, toast, onNext])

  const getSetName = (set: AppSet) => {
    const setNames = ["Set A - Closed", "Set B - Closed", "Set C - Closed", "Set D - Open"]
    return setNames[set.setIndex] || `Set ${set.setIndex + 1}`
  }

  const getTemplateName = (templateId: string) => {
    return templates.find((t) => t.id === templateId)?.questionText.slice(0, 50) || "Unknown"
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <p className="text-foreground-muted">Loading...</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Assign Templates to Sets</h3>
        <p className="text-foreground-secondary text-sm">
          {category.pointValue}-point category: 3 closed sets + 1 open set
        </p>
      </div>

      {/* Assignment controls */}
      <Card>
        <CardHeader>
          <CardTitle>Add Templates</CardTitle>
          <CardDescription>Select a set and template, then click Add</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Target Set</Label>
            <Select value={selectedSetId} onValueChange={setSelectedSetId}>
              <SelectTrigger>
                <SelectValue placeholder="Select set" />
              </SelectTrigger>
              <SelectContent>
                {categorySets.map((set) => (
                  <SelectItem key={set.id} value={set.id}>
                    {getSetName(set)} ({set.mode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Template</Label>
            <Select
              value={selectedTemplateId}
              onValueChange={setSelectedTemplateId}
              disabled={!selectedSetId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {selectedSetId &&
                  availableTemplates.all
                    .filter((template) => {
                      const set = categorySets.find((s) => s.id === selectedSetId)
                      return set ? template.mode === set.mode : true
                    })
                    .map((template) => (
                      <SelectItem key={template.id} value={template.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{template.questionText.slice(0, 40)}</span>
                          <span className="text-xs text-foreground-muted">
                            {template.mode} - {template.pointValue} pt
                          </span>
                        </div>
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Button
              onClick={handleAddTemplateToSet}
              disabled={!selectedSetId || !selectedTemplateId}
            >
              <Plus className="size-4 mr-2" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sets with assigned templates */}
      <div className="space-y-4">
        {categorySets.map((set) => (
          <Card key={set.id}>
            <CardHeader>
              <CardTitle>
                {getSetName(set)}
                <Badge className="ml-2" variant={set.mode === "closed" ? "secondary" : "default"}>
                  {set.mode === "closed" ? (
                    <Lock className="size-3" />
                  ) : (
                    <Unlock className="size-3" />
                  )}
                  {set.mode}
                </Badge>
              </CardTitle>
              <CardDescription>
                {set.mode === "closed" ? "Closed-set questions" : "Open-ended questions"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(templateAssignments.get(set.id) ?? []).length === 0 ? (
                <div className="flex items-center justify-center py-4 text-foreground-muted">
                  No templates assigned yet
                </div>
              ) : (
                <div className="space-y-3">
                  {(templateAssignments.get(set.id) ?? []).map((templateId) => (
                    <div
                      key={`${set.id}-${templateId}`}
                      className="flex items-center justify-between p-2 bg-muted rounded-lg"
                    >
                      <div>
                        <p className="font-medium">{getTemplateName(templateId)}</p>
                        <p className="text-sm text-foreground-muted">
                          {templates.find((t) => t.id === templateId)?.formula}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveTemplateFromSet(set.id, templateId)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-4 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          {cs.common.back}
        </Button>
        <Button onClick={handleContinue}>{cs.common.next}</Button>
      </div>
    </div>
  )
}
