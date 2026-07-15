import { cva } from "class-variance-authority"
import { motion } from "framer-motion"
import { Search, ShieldCheck } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
// Sub-components
import { ConstantDialog } from "@/components/constants/constant-dialog"
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
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"
// Import hooks
import { useToast } from "@/hooks/use-toast"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { ApiError, constantsApi } from "@/lib/api"
import type { Constant, ConstantInput } from "@/lib/types"
import { cn } from "@/lib/utils"

const pageContainerVariants = cva("space-y-6")

const actionButtonVariants = cva("flex items-center gap-2")

export function ConstantsPage() {
  const { toast } = useToast()
  const [constants, setConstants] = useState<Constant[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [selectedConstant, setSelectedConstant] = useState<Constant | null>(null)

  // Fetch constants
  const fetchConstants = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const data = await constantsApi.list()
      setConstants(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load constants"
      setError(message)
      toast({
        title: cs.toasts.error.createFailed.replace("{type}", cs.constants.title),
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const filteredConstants = constants.filter((constant) => {
    const isMolarMass = constant.unit === "g/mol"
    if (isMolarMass) return false
    const search = searchTerm.toLowerCase()
    return (
      constant.name.toLowerCase().includes(search) ||
      constant.symbol.toLowerCase().includes(search) ||
      constant.unit.toLowerCase().includes(search)
    )
  })

  // Handle constant actions
  const handleCreateConstant = useCallback(
    async (input: ConstantInput) => {
      try {
        await constantsApi.create(input)
        await fetchConstants()
        toast({
          title: cs.toasts.success.created.replace("{type}", cs.constants.title),
          description: `Constant "${input.name}" created successfully`,
        })
        setIsCreateDialogOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to create constant"
        toast({
          title: cs.toasts.error.createFailed.replace("{type}", cs.constants.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchConstants, toast],
  )

  const handleUpdateConstant = useCallback(
    async (id: string, input: Partial<ConstantInput>) => {
      try {
        await constantsApi.update(id, input)
        await fetchConstants()
        toast({
          title: cs.toasts.success.updated.replace("{type}", cs.constants.title),
          description: `Constant "${input.name}" updated successfully`,
        })
        setIsEditDialogOpen(false)
        setSelectedConstant(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to update constant"
        toast({
          title: cs.toasts.error.updateFailed.replace("{type}", cs.constants.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchConstants, toast],
  )

  const handleDeleteConstant = useCallback(
    async (id: string) => {
      try {
        await constantsApi.delete(id)
        await fetchConstants()
        toast({
          title: cs.toasts.success.deleted.replace("{type}", cs.constants.title),
          description: "Constant deleted successfully",
        })
        setIsDeleteDialogOpen(false)
        setSelectedConstant(null)
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to delete constant"
        toast({
          title: cs.toasts.error.deleteFailed.replace("{type}", cs.constants.title),
          description: message,
          variant: "destructive",
        })
      }
    },
    [fetchConstants, toast],
  )

  // Open dialog handlers
  const openEditDialog = useCallback((constant: Constant) => {
    setSelectedConstant(constant)
    setIsEditDialogOpen(true)
  }, [])

  const openDeleteDialog = useCallback((constant: Constant) => {
    setSelectedConstant(constant)
    setIsDeleteDialogOpen(true)
  }, [])

  // Load constants on mount
  useEffect(() => {
    fetchConstants()
  }, [fetchConstants])

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
            <h1 className="text-2xl font-bold text-foreground">{cs.constants.title}</h1>
            <p className="text-foreground-secondary mt-1">{cs.constants.pageDescription}</p>
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
          {cs.constants.createConstant}
        </Button>
      </motion.div>

      {/* Constants table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{cs.constants.columns.name}</CardTitle>
            <CardDescription>
              {filteredConstants.length} {cs.constants.title.toLowerCase()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-destructive">{error}</div>
            ) : isLoading ? (
              <div className="text-foreground-muted">{cs.toasts.info.loading}</div>
            ) : filteredConstants.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <p className="text-foreground-secondary mb-4">{cs.constants.emptyState.title}</p>
                <p className="text-foreground-muted text-sm mb-4">
                  {cs.constants.emptyState.description}
                </p>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  {cs.constants.emptyState.cta}
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{cs.constants.columns.name}</TableHead>
                    <TableHead>{cs.constants.columns.symbol}</TableHead>
                    <TableHead>{cs.constants.columns.value}</TableHead>
                    <TableHead>{cs.constants.columns.unit}</TableHead>
                    <TableHead className="text-center">{cs.constants.columns.actions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredConstants.map((constant) => (
                    <TableRow key={constant.id}>
                      <TableCell className="font-medium">
                        {constant.name}
                        {constant.isBuiltin && (
                          <Badge variant="outline" className="ml-2">
                            <ShieldCheck className="size-3" />
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{constant.symbol}</Badge>
                      </TableCell>
                      <TableCell>{constant.value}</TableCell>
                      <TableCell>{constant.unit}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEditDialog(constant)}
                            title="Edit constant"
                          >
                            {cs.common.edit}
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => openDeleteDialog(constant)}
                            title="Delete constant"
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

      {/* Create Constant Dialog */}
      <ConstantDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onSubmit={handleCreateConstant}
        title={cs.constants.createConstant}
        confirmText={cs.common.create}
      />

      {/* Edit Constant Dialog */}
      {selectedConstant && (
        <ConstantDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          onSubmit={(input) => handleUpdateConstant(selectedConstant.id, input)}
          title={cs.constants.editConstant}
          confirmText={cs.common.save}
          initialValues={selectedConstant}
        />
      )}

      {/* Delete Confirmation Dialog */}
      {selectedConstant && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={() => handleDeleteConstant(selectedConstant.id)}
          title={cs.constants.deleteConstant}
          description={cs.constants.deleteConfirm.replace("{name}", selectedConstant.name)}
        />
      )}
    </motion.div>
  )
}
