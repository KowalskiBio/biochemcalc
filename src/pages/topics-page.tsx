import { BookOpen, GraduationCap, Lock, Plus } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"

import { CreateTopicDialog } from "@/components/topics/create-topic-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, topicsApi } from "@/lib/api"
import type { Topic } from "@/lib/types"
import { useCarryStore } from "@/stores/drag-store"

export function TopicsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [topics, setTopics] = useState<Topic[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [toggling, setToggling] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [hoveredTopic, setHoveredTopic] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isCarrying = useCarryStore((s) => s.isCarrying)

  const fetchTopics = useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await topicsApi.list()
      setTopics(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: "Chyba", description: message, variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchTopics()
  }, [fetchTopics])

  const handleToggle = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (toggling) return
      setToggling(topic.id)
      try {
        const updated = await topicsApi.update(topic.id, topic.name, !topic.forStudents)
        setTopics((prev) => (prev.map((t) => (t.id === updated.id ? updated : t))))
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: "Chyba", description: message, variant: "destructive" })
      } finally {
        setToggling(null)
      }
    },
    [toggling, toast],
  )

  const handleTopicMouseEnter = useCallback(
    (topicId: string) => {
      if (!isCarrying) return
      setHoveredTopic(topicId)
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = setTimeout(() => {
        navigate(`/topics/${topicId}`)
      }, 1500)
    },
    [isCarrying, navigate],
  )

  const handleTopicMouseLeave = useCallback(() => {
    setHoveredTopic(null)
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {cs.topics.pageTitle}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">{cs.topics.pageDescription}</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setIsCreateDialogOpen(true)}>
              <Plus className="size-4 mr-2" />
              {cs.topics.createTopic}
            </Button>
            <Button asChild variant="outline">
              <Link to="/bulk-import">
                <Plus className="size-4 mr-2" />
                {cs.topics.addMore}
              </Link>
            </Button>
          </div>
        </div>
      </div>

      <div>
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-foreground-muted">Načítám témata...</p>
            </CardContent>
          </Card>
        ) : topics.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="size-12 text-foreground-muted mx-auto mb-4" />
              <p className="text-muted-foreground">{cs.topics.noTopics}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topics.map((topic) => {
              const isHighlighted = isCarrying && hoveredTopic === topic.id
              return (
                <div key={topic.id}>
                  {isCarrying ? (
                    <Card
                      className={`h-full cursor-pointer transition-colors ${
                        isHighlighted
                          ? "border-primary border-2 ring-2 ring-primary/40 bg-primary/5"
                          : "border-primary border-2 border-dashed hover:bg-primary/5"
                      }`}
                      onMouseEnter={() => handleTopicMouseEnter(topic.id)}
                      onMouseLeave={handleTopicMouseLeave}
                      onClick={() => navigate(`/topics/${topic.id}`)}
                    >
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <BookOpen className="size-5 text-primary" />
                          {topic.name}
                        </CardTitle>
                        <CardDescription>
                          {new Date(topic.createdAt).toLocaleDateString("cs-CZ")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <p className="text-xs text-primary text-center">
                          {isHighlighted ? "Přejít do tématu…" : cs.topics.dropQuestionHere}
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    <Link to={`/topics/${topic.id}`}>
                      <Card className="h-full cursor-pointer hover:border-primary transition-colors">
                        <CardHeader>
                          <CardTitle className="flex items-center gap-2">
                            <BookOpen className="size-5 text-primary" />
                            {topic.name}
                          </CardTitle>
                          <CardDescription>
                            {new Date(topic.createdAt).toLocaleDateString("cs-CZ")}
                          </CardDescription>
                        </CardHeader>
                        <CardContent>
                          <button
                            type="button"
                            disabled={toggling === topic.id}
                            onClick={(e) => handleToggle(topic, e)}
                            className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-full border transition-colors w-full justify-center ${
                              topic.forStudents
                                ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                                : "border-border bg-muted/40 text-muted-foreground hover:bg-muted"
                            } disabled:opacity-50 disabled:cursor-not-allowed`}
                          >
                            {topic.forStudents ? (
                              <>
                                <GraduationCap className="size-4" />
                                Pro studenty
                              </>
                            ) : (
                              <>
                                <Lock className="size-4" />
                                Pouze pro učitele
                              </>
                            )}
                          </button>
                        </CardContent>
                      </Card>
                    </Link>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <CreateTopicDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreated={(topic) => navigate(`/topics/${topic.id}`)}
      />
    </div>
  )
}
