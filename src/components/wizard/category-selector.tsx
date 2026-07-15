import { Plus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

// Import shadcn/ui components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ApiError, categoriesApi } from "@/lib/api"
import type { Category } from "@/lib/types"

interface CategorySelectorProps {
  selectedCategory: Category | null
  onCategorySelect: (category: Category) => void
}

const pointValues = [2, 3, 4]

export function CategorySelector({ selectedCategory, onCategorySelect }: CategorySelectorProps) {
  const { toast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [newCategoryPointValue, setNewCategoryPointValue] = useState<number>(2)

  // Fetch categories
  const fetchCategories = useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await categoriesApi.list()
      setCategories(data)
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to load categories",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  // Create new category
  const handleCreateCategory = useCallback(async () => {
    try {
      const newCategory = await categoriesApi.create({
        pointValue: newCategoryPointValue,
      })
      await fetchCategories()
      onCategorySelect(newCategory)
      setIsDialogOpen(false)
      setNewCategoryPointValue(2)
      toast({
        title: cs.toasts.success.created.replace("{type}", "Category"),
        description: `${newCategoryPointValue}-point category created successfully`,
      })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to create category"
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      })
    }
  }, [newCategoryPointValue, fetchCategories, onCategorySelect, toast])

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Select a Category</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Create new category button */}
        <Card
          className="cursor-pointer hover:shadow-md transition-shadow border-dashed border-border"
          onClick={() => setIsDialogOpen(true)}
        >
          <CardContent className="flex flex-col items-center justify-center h-32">
            <Plus className="size-8 text-foreground-muted mb-2" />
            <p className="text-sm text-foreground-muted">Create new category</p>
          </CardContent>
        </Card>

        {/* Existing categories */}
        {isLoading ? (
          <Card>
            <CardContent className="flex items-center justify-center h-32">
              <p className="text-foreground-muted">Loading categories...</p>
            </CardContent>
          </Card>
        ) : categories.length === 0 ? (
          <Card>
            <CardContent className="flex items-center justify-center h-32">
              <p className="text-foreground-muted">No categories yet</p>
            </CardContent>
          </Card>
        ) : (
          categories.map((category) => (
            <Card
              key={category.id}
              className={`cursor-pointer transition-all ${selectedCategory?.id === category.id ? "ring-2 ring-primary border-primary" : "hover:shadow-md"}`}
              onClick={() => onCategorySelect(category)}
            >
              <CardHeader>
                <CardTitle className="text-center">{category.pointValue}-point category</CardTitle>
                <CardDescription className="text-center">
                  {category.pointValue === 2 && "2-point questions"}
                  {category.pointValue === 3 && "3-point questions"}
                  {category.pointValue === 4 && "4-point questions"}
                </CardDescription>
              </CardHeader>
            </Card>
          ))
        )}
      </div>

      {/* Create Category Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Create New Category</DialogTitle>
            <DialogDescription>Create a new category with specific point value</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="pointValue">Point Value</Label>
              <Select
                value={String(newCategoryPointValue)}
                onValueChange={(value) => setNewCategoryPointValue(parseInt(value, 10))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select point value" />
                </SelectTrigger>
                <SelectContent>
                  {pointValues.map((value) => (
                    <SelectItem key={value} value={String(value)}>
                      {value} points
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              {cs.common.cancel}
            </Button>
            <Button onClick={handleCreateCategory}>{cs.common.create}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
