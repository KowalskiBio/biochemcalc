import { cva } from "class-variance-authority"
import { motion } from "framer-motion"
import { Lock, Search, Unlock } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { TemplateDialog } from "@/components/templates/template-dialog"
import { Badge } from "@/components/ui/badge"
// Import shadcn/ui components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { UnitRenderer } from "@/components/ui/unit-renderer"
// Sub-components
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"
// Import hooks
import { useToast } from "@/hooks/use-toast"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { ApiError, templatesApi } from "@/lib/api"
import type { Template, TemplateInput, TemplateMode } from "@/lib/types"
import { cn } from "@/lib/utils"

const pageContainerVariants = cva("space-y-6")

const actionButtonVariants = cva("flex items-center gap-2")

const modeBadgeVariants = cva("px-2 py-1 rounded-full text-xs font-medium", {
  variants: {
    mode: {
      closed: "bg-secondary/10 text-secondary",
      open: "bg-accent/10 text-accent",
    },
  },
})

export function TemplatesPage() {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [modeFilter, setModeFilter] = useState<"all" | TemplateMode>("all")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await templatesApi.list()
      setTemplates(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load templates"
      setError(message)
      toast({
        title: cs.toasts.error.createFailed.replace("{type}", cs.templates.title),
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  // Filter templates based on search term and mode filter
  const filteredTemplates = templates.filter((template) => {
    const search = searchTerm.toLowerCase()
    const matchesSearch =
      template.questionText.toLowerCase().includes(search) ||
      template.resultUnit.toLowerCase().includes(search)
    const matchesMode = modeFilter === "all" || template.mode === modeFilter
    return matchesSearch && matchesMode
  })

  // Handle template actions
  const handleCreateTemplate = useCallback(
    async (input: TemplateInput) => {
      try {
        await templatesApi.create(input)
        await fetchTemplates()
        toast({
          title: cs.toasts.success.created.replace("{type}", cs.templates.title),
          description: `Template created successfully`,
        })
        setIsCreateDialogOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create template"
        toast({
          title: cs.toasts.error.createFailed.replace("{type}", cs.templates.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchTemplates, toast],
  )

  const handleUpdateTemplate = useCallback(
    async (id: string, input: Partial<TemplateInput>) => {
      try {
        await templatesApi.update(id, input)
        await fetchTemplates()
        toast({
          title: cs.toasts.success.updated.replace("{type}", cs.templates.title),
          description: `Template updated successfully`,
        })
        setIsEditDialogOpen(false)
        setSelectedTemplate(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update template"
        toast({
          title: cs.toasts.error.updateFailed.replace("{type}", cs.templates.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchTemplates, toast],
  )

  const handleDeleteTemplate = useCallback(
    async (id: string) => {
      try {
        await templatesApi.delete(id)
        await fetchTemplates()
        toast({
          title: cs.toasts.success.deleted.replace("{type}", cs.templates.title),
          description: "Template deleted successfully",
        })
        setIsDeleteDialogOpen(false)
        setSelectedTemplate(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete template"
        toast({
          title: cs.toasts.error.deleteFailed.replace("{type}", cs.templates.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchTemplates, toast],
  )

  // Open dialog handlers
  const openEditDialog = useCallback((template: Template) => {
    setSelectedTemplate(template)
    setIsEditDialogOpen(true)
  }, [])

  const openDeleteDialog = useCallback((template: Template) => {
    setSelectedTemplate(template)
    setIsDeleteDialogOpen(true)
  }, [])

  // Mode filter options
  const modeOptions = [
    { value: "all", label: "Všechny" },
    { value: "closed", label: cs.templates.mode.closed, icon: <Lock className="size-3" /> },
    { value: "open", label: cs.templates.mode.open, icon: <Unlock className="size-3" /> },
  ]

  // Load templates on mount
  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={cn(pageContainerVariants())}
    >
      {/* Page header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{cs.templates.title}</h1>
            <p className="text-foreground-secondary mt-1">{cs.templates.pageDescription}</p>
          </div>

          {/* Mode filter */}
          <div className="flex items-center gap-2">
            {modeOptions.map((option) => (
              <Button
                key={option.value}
                variant={modeFilter === option.value ? "secondary" : "outline"}
                size="sm"
                onClick={() => setModeFilter(option.value as "all" | TemplateMode)}
                className="flex items-center gap-1"
              >
                {option.icon && option.icon}
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Actions bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="flex flex-col sm:flex-row gap-4"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground-muted" />
          <Input
            type="text"
            placeholder={`${cs.common.search}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <Button className={cn(actionButtonVariants())} onClick={() => setIsCreateDialogOpen(true)}>
          {cs.templates.createTemplate}
        </Button>
      </motion.div>

      {/* Templates table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{cs.templates.title}</CardTitle>
            <CardDescription>
              {filteredTemplates.length} {cs.templates.title.toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-destructive">{error}</div>
            ) : isLoading ? (
              <div className="text-foreground-muted">{cs.toasts.info.loading}</div>
            ) : filteredTemplates.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-foreground-secondary mb-4">{cs.templates.emptyState.title}</p>
                <p className="text-foreground-muted text-sm mb-4">
                  {cs.templates.emptyState.description}
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  {cs.templates.emptyState.cta}
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Otázka</TableHead>
                    <TableHead>Vzorec</TableHead>
                    <TableHead>{cs.templates.pointValue}</TableHead>
                    <TableHead>Mod</TableHead>
                    <TableHead>{cs.templates.resultUnit}</TableHead>
                    <TableHead className="text-right">{cs.templates.columns.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTemplates.map((template) => (
                    <TableRow key={template.id}>
                      <TableCell className="max-w-[200px] truncate">
                        {template.questionText}
                      </TableCell>
                      <TableCell className="max-w-[150px] truncate font-mono text-sm">
                        {template.formula}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{template.pointValue} pt</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn(modeBadgeVariants({ mode: template.mode }))}>
                          {template.mode === "closed" ? (
                            <Lock className="size-3" />
                          ) : (
                            <Unlock className="size-3" />
                          )}
                          {template.mode === "closed"
                            ? cs.templates.mode.closed
                            : cs.templates.mode.open}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <UnitRenderer unit={template.resultUnit} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(template)}
                          >
                            {cs.common.edit}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDeleteDialog(template)}
                          >
                            {cs.common.delete}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Create Template Dialog */}
      <TemplateDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleCreateTemplate}
        title={cs.templates.createTemplate}
        confirmText={cs.common.create}
      />

      {/* Edit Template Dialog */}
      {selectedTemplate && (
        <TemplateDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSubmit={(input) => handleUpdateTemplate(selectedTemplate.id, input)}
          title={cs.templates.editTemplate}
          confirmText={cs.common.save}
          initialValues={{
            questionText: selectedTemplate.questionText,
            formula: selectedTemplate.formula,
            resultUnit: selectedTemplate.resultUnit,
            pointValue: selectedTemplate.pointValue,
            mode: selectedTemplate.mode,
            variables: selectedTemplate.variables,
            constants: selectedTemplate.constants,
            constraint: selectedTemplate.constraint,
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {selectedTemplate && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={() => handleDeleteTemplate(selectedTemplate.id)}
          title={cs.templates.deleteTemplate}
          description={cs.templates.deleteConfirm.replace(
            "{name}",
            selectedTemplate.questionText.slice(0, 50),
          )}
        />
      )}
    </motion.div>
  )
}
