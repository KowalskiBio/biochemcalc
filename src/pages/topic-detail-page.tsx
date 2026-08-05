import { ArrowLeft, Layers, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, categoriesApi, topicsApi } from "@/lib/api"
import type { Category, CategoryWithSets, Topic } from "@/lib/types"

export function TopicDetailPage() {
  const { topicId } = useParams<{ topicId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [topic, setTopic] = useState<Topic | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [categoriesWithSets, setCategoriesWithSets] = useState<CategoryWithSets[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const loadData = useCallback(async () => {
    if (!topicId) return
    try {
      setIsLoading(true)
      const [topicData, catList] = await Promise.all([
        topicsApi.get(topicId),
        categoriesApi.listByTopic(topicId),
      ])
      setTopic(topicData)
      setCategories(catList)

      const withSets = await Promise.all(
        catList.map(async (cat) => {
          try {
            return await categoriesApi.getWithSets(cat.id)
          } catch {
            return { category: cat, sets: [] }
          }
        }),
      )
      setCategoriesWithSets(withSets)
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
  }, [topicId, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleDelete = useCallback(async () => {
    if (!topicId) return
    try {
      setIsDeleting(true)
      await topicsApi.delete(topicId)
      toast({
        title: cs.topics.deleteSuccess,
      })
      navigate("/topics")
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: cs.topics.deleteError,
        description: message,
        variant: "destructive",
      })
      setIsDeleting(false)
      setIsDeleteDialogOpen(false)
    }
  }, [topicId, navigate, toast])

  const modeLabel = (mode: string) =>
    mode === "closed" ? cs.topics.mode.closed : cs.topics.mode.open

  const modeVariant = (mode: string) =>
    mode === "closed" ? ("secondary" as const) : ("default" as const)

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Načítám téma...</p>
        </CardContent>
      </Card>
    )
  }

  if (!topic) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground">Téma nenalezeno.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link to="/topics">Zpět na témata</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div
      className="space-y-6"
    >
      <div
        className="flex items-center gap-4"
      >
        <Button variant="ghost" size="icon" asChild>
          <Link to="/topics">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{topic.name}</h1>
          <p className="text-muted-foreground text-sm">
            {categories.length} {cs.topics.categories.toLowerCase()}
          </p>
        </div>
        <Button
          variant="destructive"
          onClick={() => setIsDeleteDialogOpen(true)}
          disabled={isDeleting}
          className="ml-auto"
        >
          <Trash2 className="size-4 mr-2" />
          {cs.common.delete}
        </Button>
      </div>

      <div
        className="space-y-6"
      >
        {categoriesWithSets
          .sort((a, b) => a.category.pointValue - b.category.pointValue)
          .map(({ category, sets }) => (
            <Card key={category.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Layers className="size-5 text-primary" />
                  <span>
                    {cs.topics.pointValue.replace("{value}", String(category.pointValue))}
                  </span>
                </CardTitle>
                <CardDescription>
                  {sets.length} {cs.topics.sets.toLowerCase()}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {sets
                    .sort((a, b) => a.setIndex - b.setIndex)
                     .map((set) => (
                       <div
                         key={set.id}
                       >
                         <Link to={`/sets/${set.id}`}>
                          <Card className="cursor-pointer hover:border-primary transition-colors">
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-sm">
                                  {cs.topics.setIndex.replace("{index}", String(set.setIndex))}
                                </span>
                                <Badge variant={modeVariant(set.mode)}>{modeLabel(set.mode)}</Badge>
                              </div>
                            </CardContent>
                          </Card>
                        </Link>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          ))}
      </div>

      {topic && (
        <DeleteConfirmDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          onConfirm={handleDelete}
          title={cs.topics.deleteTopic}
          description={cs.topics.deleteTopicConfirm.replace("{name}", topic.name)}
        />
      )}
    </div>
  )
}
