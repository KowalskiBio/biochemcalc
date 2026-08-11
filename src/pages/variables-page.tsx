import { cva } from "class-variance-authority"
import { Search } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
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
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"
// Sub-components
import { VariableDialog } from "@/components/variables/variable-dialog"
// Import hooks
import { useToast } from "@/hooks/use-toast"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { ApiError, variablesApi } from "@/lib/api"
import type { Variable, VariableInput } from "@/lib/types"
import { cn } from "@/lib/utils"

const pageContainerVariants = cva("space-y-6")

const actionButtonVariants = cva("flex items-center gap-2")

export function VariablesPage() {
  const { toast } = useToast()
  const [variables, setVariables] = useState<Variable[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedVariable, setSelectedVariable] = useState<Variable | null>(null)

  // Fetch variables
  const fetchVariables = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await variablesApi.list()
      setVariables(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load variables"
      setError(message)
      toast({
        title: cs.toasts.error.createFailed.replace("{type}", cs.variables.title),
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  // Filter variables based on search term
  const filteredVariables = variables.filter((variable) => {
    const search = searchTerm.toLowerCase()
    return (
      variable.name.toLowerCase().includes(search) ||
      variable.symbol.toLowerCase().includes(search) ||
      variable.unit.toLowerCase().includes(search)
    )
  })

  // Handle variable actions
  const handleCreateVariable = useCallback(
    async (input: VariableInput) => {
      try {
        await variablesApi.create(input)
        await fetchVariables()
        toast({
          title: cs.toasts.success.created.replace("{type}", cs.variables.title),
          description: `Variable "${input.name}" created successfully`,
        })
        setIsCreateDialogOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create variable"
        toast({
          title: cs.toasts.error.createFailed.replace("{type}", cs.variables.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchVariables, toast],
  )

  const handleUpdateVariable = useCallback(
    async (id: string, input: Partial<VariableInput>) => {
      try {
        await variablesApi.update(id, input)
        await fetchVariables()
        toast({
          title: cs.toasts.success.updated.replace("{type}", cs.variables.title),
          description: `Variable "${input.name}" updated successfully`,
        })
        setIsEditDialogOpen(false)
        setSelectedVariable(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update variable"
        toast({
          title: cs.toasts.error.updateFailed.replace("{type}", cs.variables.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchVariables, toast],
  )

  const handleDeleteVariable = useCallback(
    async (id: string) => {
      try {
        await variablesApi.delete(id)
        await fetchVariables()
        toast({
          title: cs.toasts.success.deleted.replace("{type}", cs.variables.title),
          description: "Variable deleted successfully",
        })
        setIsDeleteDialogOpen(false)
        setSelectedVariable(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete variable"
        toast({
          title: cs.toasts.error.deleteFailed.replace("{type}", cs.variables.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchVariables, toast],
  )

  // Open dialog handlers
  const openEditDialog = useCallback((variable: Variable) => {
    setSelectedVariable(variable)
    setIsEditDialogOpen(true)
  }, [])

  const openDeleteDialog = useCallback((variable: Variable) => {
    setSelectedVariable(variable)
    setIsDeleteDialogOpen(true)
  }, [])

  // Load variables on mount
  useEffect(() => {
    fetchVariables()
  }, [fetchVariables])

  return (
    <div className={cn(pageContainerVariants())}>
      {/* Page header */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {cs.variables.title}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{cs.variables.pageDescription}</p>
          </div>
        </div>
      </div>

      {/* Actions bar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder={`${cs.common.search}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <Button className={cn(actionButtonVariants())} onClick={() => setIsCreateDialogOpen(true)}>
          {cs.variables.createVariable}
        </Button>
      </div>

      {/* Variables table */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle>{cs.variables.columns.name}</CardTitle>
            <CardDescription>
              <span className="font-mono tabular">{filteredVariables.length}</span>{" "}
              {cs.variables.title.toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-destructive">{error}</div>
            ) : isLoading ? (
              <div className="text-muted-foreground">{cs.toasts.info.loading}</div>
            ) : filteredVariables.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-muted-foreground mb-4">{cs.variables.emptyState.title}</p>
                <p className="text-muted-foreground text-sm mb-4">
                  {cs.variables.emptyState.description}
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  {cs.variables.emptyState.cta}
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{cs.variables.columns.name}</TableHead>
                    <TableHead>{cs.variables.columns.symbol}</TableHead>
                    <TableHead>{cs.variables.columns.range}</TableHead>
                    <TableHead>{cs.variables.columns.unit}</TableHead>
                    <TableHead className="text-right">{cs.variables.columns.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredVariables.map((variable) => (
                    <TableRow key={variable.id}>
                      <TableCell className="font-medium">{variable.name}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{variable.symbol}</Badge>
                      </TableCell>
                      <TableCell className="font-mono tabular">
                        {variable.minValue} - {variable.maxValue}
                        {variable.step && ` (${variable.step})`}
                      </TableCell>
                      <TableCell>
                        <UnitRenderer unit={variable.unit} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(variable)}
                          >
                            {cs.common.edit}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDeleteDialog(variable)}
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
      </div>

      {/* Create Variable Dialog */}
      <VariableDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleCreateVariable}
        title={cs.variables.createVariable}
        confirmText={cs.common.create}
      />

      {/* Edit Variable Dialog */}
      {selectedVariable && (
        <VariableDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSubmit={(input) => handleUpdateVariable(selectedVariable.id, input)}
          title={cs.variables.editVariable}
          confirmText={cs.common.save}
          initialValues={selectedVariable}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {selectedVariable && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={() => handleDeleteVariable(selectedVariable.id)}
          title={cs.variables.deleteVariable}
          description={cs.variables.deleteConfirm.replace("{name}", selectedVariable.name)}
        />
      )}
    </div>
  )
}
