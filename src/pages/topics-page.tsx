import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FolderPlus,
  GraduationCap,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"

import { CreateGroupDialog } from "@/components/topics/create-group-dialog"
import { CreateTopicDialog } from "@/components/topics/create-topic-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { RefreshOverlay } from "@/components/ui/refresh-overlay"
import { Skeleton } from "@/components/ui/skeleton"
import { DeleteConfirmDialog } from "@/components/variables/delete-confirm-dialog"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, topicGroupsApi, topicsApi } from "@/lib/api"
import type { Topic, TopicGroup } from "@/lib/types"
import { useCarryStore } from "@/stores/drag-store"

export function TopicsPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [topics, setTopics] = useState<Topic[]>([])
  const [groups, setGroups] = useState<TopicGroup[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const hasLoadedRef = useRef(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [duplicatingTopicId, setDuplicatingTopicId] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false)
  const [hoveredTopic, setHoveredTopic] = useState<string | null>(null)
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editGroupName, setEditGroupName] = useState("")
  const [deletingGroup, setDeletingGroup] = useState<TopicGroup | null>(null)

  const isCarrying = useCarryStore((s) => s.isCarrying)
  const carryKind = useCarryStore((s) => s.kind)
  const carriedTopic = useCarryStore((s) => s.topic)
  const startTopicCarry = useCarryStore((s) => s.startTopicCarry)
  const endCarry = useCarryStore((s) => s.endCarry)

  const justDraggedRef = useRef(false)

  const isCarryingQuestionOrSet = isCarrying && (carryKind === "question" || carryKind === "set")
  const isCarryingTopic = isCarrying && carryKind === "topic"

  const fetchAll = useCallback(async () => {
    if (hasLoadedRef.current) {
      setIsRefreshing(true)
    } else {
      setIsLoading(true)
    }
    try {
      const [topicsData, groupsData] = await Promise.all([topicsApi.list(), topicGroupsApi.list()])
      setTopics(topicsData)
      setGroups(groupsData)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: "Chyba", description: message, variant: "destructive" })
    } finally {
      hasLoadedRef.current = true
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const filteredTopics = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return topics
    return topics.filter((t) => t.name.toLowerCase().includes(term))
  }, [topics, searchTerm])

  const groupsSorted = useMemo(() => [...groups].sort((a, b) => a.position - b.position), [groups])

  const topicsByGroup = useMemo(() => {
    const map = new Map<string, Topic[]>()
    for (const topic of filteredTopics) {
      if (!topic.groupId) continue
      const list = map.get(topic.groupId) ?? []
      list.push(topic)
      map.set(topic.groupId, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.position - b.position)
    }
    return map
  }, [filteredTopics])

  const unsortedTopics = useMemo(
    () => filteredTopics.filter((t) => !t.groupId).sort((a, b) => a.position - b.position),
    [filteredTopics],
  )

  const handleToggle = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (toggling) return
      setToggling(topic.id)
      try {
        const updated = await topicsApi.update(topic.id, topic.name, !topic.forStudents)
        setTopics((prev) => prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)))
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: "Chyba", description: message, variant: "destructive" })
      } finally {
        setToggling(null)
      }
    },
    [toggling, toast],
  )

  const handleDuplicate = useCallback(
    async (topic: Topic, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (duplicatingTopicId) return
      setDuplicatingTopicId(topic.id)
      try {
        const newTopic = await topicsApi.duplicate(topic.id)
        toast({ title: cs.topics.duplicateSuccess })
        navigate(`/topics/${newTopic.id}`)
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: cs.topics.duplicateError, description: message, variant: "destructive" })
      } finally {
        setDuplicatingTopicId(null)
      }
    },
    [duplicatingTopicId, toast, navigate],
  )

  const handleTopicMouseDown = useCallback(
    (e: React.MouseEvent, topic: Topic) => {
      if (e.button !== 0 || isCarrying) return
      const startX = e.clientX
      const startY = e.clientY

      const handleMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        if (Math.sqrt(dx * dx + dy * dy) > 5) {
          cleanup()
          justDraggedRef.current = true
          startTopicCarry(topic)
        }
      }
      const handleUp = () => cleanup()
      const cleanup = () => {
        document.removeEventListener("mousemove", handleMove)
        document.removeEventListener("mouseup", handleUp)
      }
      document.addEventListener("mousemove", handleMove)
      document.addEventListener("mouseup", handleUp)
    },
    [isCarrying, startTopicCarry],
  )

  const handleDropTopicOnGroup = useCallback(
    async (groupId: string | null) => {
      if (!carriedTopic) return
      try {
        await topicsApi.moveToGroup(carriedTopic.id, groupId)
        await fetchAll()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: "Chyba", description: message, variant: "destructive" })
      } finally {
        endCarry()
      }
    },
    [carriedTopic, toast, fetchAll, endCarry],
  )

  const handleTopicMouseEnter = useCallback(
    (topicId: string) => {
      if (!isCarryingQuestionOrSet) return
      setHoveredTopic(topicId)
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = setTimeout(() => {
        navigate(`/topics/${topicId}`)
      }, 1500)
    },
    [isCarryingQuestionOrSet, navigate],
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

  const handleStartRenameGroup = useCallback((group: TopicGroup, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingGroupId(group.id)
    setEditGroupName(group.name)
  }, [])

  const handleSaveGroupName = useCallback(
    async (group: TopicGroup) => {
      const trimmed = editGroupName.trim()
      setEditingGroupId(null)
      if (!trimmed || trimmed === group.name) return
      try {
        await topicGroupsApi.rename(group.id, trimmed)
        setGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, name: trimmed } : g)))
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: cs.topics.renameError, description: message, variant: "destructive" })
      }
    },
    [editGroupName, toast],
  )

  const handleMoveGroup = useCallback(
    async (index: number, direction: -1 | 1) => {
      const newIndex = index + direction
      if (newIndex < 0 || newIndex >= groupsSorted.length) return
      const reordered = [...groupsSorted]
      const tmp = reordered[index]
      reordered[index] = reordered[newIndex]
      reordered[newIndex] = tmp
      setGroups(reordered.map((g, i) => ({ ...g, position: i })))
      try {
        await topicGroupsApi.reorder(reordered.map((g) => g.id))
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({ title: "Chyba", description: message, variant: "destructive" })
        fetchAll()
      }
    },
    [groupsSorted, toast, fetchAll],
  )

  const handleConfirmDeleteGroup = useCallback(async () => {
    if (!deletingGroup) return
    try {
      await topicGroupsApi.delete(deletingGroup.id)
      toast({ title: cs.topics.deleteGroupSuccess })
      await fetchAll()
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.deleteGroupError, description: message, variant: "destructive" })
    } finally {
      setDeletingGroup(null)
    }
  }, [deletingGroup, toast, fetchAll])

  const renderTopicCard = useCallback(
    (topic: Topic) => {
      const isHighlighted = isCarryingQuestionOrSet && hoveredTopic === topic.id
      const isBeingCarried = isCarryingTopic && carriedTopic?.id === topic.id

      if (isCarryingQuestionOrSet) {
        return (
          <Card
            key={topic.id}
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
        )
      }

      return (
        <Card
          key={topic.id}
          className={`h-full cursor-pointer hover:border-primary transition-colors ${
            isBeingCarried ? "opacity-40 border-primary" : ""
          }`}
          onMouseDown={(e) => handleTopicMouseDown(e, topic)}
          onClick={() => {
            if (justDraggedRef.current) {
              justDraggedRef.current = false
              return
            }
            if (isCarrying) return
            navigate(`/topics/${topic.id}`)
          }}
        >
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-5 text-primary" />
                {topic.name}
              </CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={duplicatingTopicId === topic.id}
                title={cs.common.duplicate}
                aria-label={cs.common.duplicate}
                onClick={(e) => handleDuplicate(topic, e)}
              >
                {duplicatingTopicId === topic.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
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
      )
    },
    [
      isCarryingQuestionOrSet,
      isCarryingTopic,
      carriedTopic,
      hoveredTopic,
      isCarrying,
      toggling,
      duplicatingTopicId,
      handleTopicMouseEnter,
      handleTopicMouseLeave,
      handleTopicMouseDown,
      handleToggle,
      handleDuplicate,
      navigate,
    ],
  )

  const renderGroupBox = useCallback(
    (group: TopicGroup, index: number) => {
      const groupTopics = topicsByGroup.get(group.id) ?? []
      const isDropTarget = isCarryingTopic && hoveredGroup === group.id
      const isEditing = editingGroupId === group.id

      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: drop target for mouse drag-and-drop; keyboard DnD parity is a follow-up
        <div
          key={group.id}
          className={`rounded-xl border-2 p-4 transition-colors ${
            isDropTarget
              ? "border-primary ring-2 ring-primary/40 bg-primary/5"
              : isCarryingTopic
                ? "border-primary border-dashed"
                : "border-border"
          }`}
          onMouseEnter={() => {
            if (isCarryingTopic) setHoveredGroup(group.id)
          }}
          onMouseLeave={() => {
            if (isCarryingTopic) setHoveredGroup(null)
          }}
          onMouseUp={() => {
            if (isCarryingTopic) void handleDropTopicOnGroup(group.id)
          }}
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            {isEditing ? (
              <div className="flex items-center gap-1 flex-1">
                <Input
                  autoFocus
                  value={editGroupName}
                  onChange={(e) => setEditGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveGroupName(group)
                    if (e.key === "Escape") setEditingGroupId(null)
                  }}
                  className="h-8"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => void handleSaveGroupName(group)}
                >
                  <Check className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  onClick={() => setEditingGroupId(null)}
                >
                  <X className="size-4" />
                </Button>
              </div>
            ) : (
              <h3 className="font-semibold text-foreground">{group.name}</h3>
            )}
            {!isEditing && (
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === 0}
                  title={cs.topics.moveGroupUp}
                  aria-label={cs.topics.moveGroupUp}
                  onClick={() => void handleMoveGroup(index, -1)}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={index === groupsSorted.length - 1}
                  title={cs.topics.moveGroupDown}
                  aria-label={cs.topics.moveGroupDown}
                  onClick={() => void handleMoveGroup(index, 1)}
                >
                  <ChevronDown className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  title={cs.topics.renameGroup}
                  aria-label={cs.topics.renameGroup}
                  onClick={(e) => handleStartRenameGroup(group, e)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  title={cs.topics.deleteGroup}
                  aria-label={cs.topics.deleteGroup}
                  onClick={() => setDeletingGroup(group)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            )}
          </div>
          {groupTopics.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2 text-center">
              {isCarryingTopic ? cs.topics.dropTopicHere : cs.topics.noTopics}
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupTopics.map((topic) => renderTopicCard(topic))}
            </div>
          )}
        </div>
      )
    },
    [
      topicsByGroup,
      isCarryingTopic,
      hoveredGroup,
      editingGroupId,
      editGroupName,
      groupsSorted.length,
      handleDropTopicOnGroup,
      handleSaveGroupName,
      handleMoveGroup,
      handleStartRenameGroup,
      renderTopicCard,
    ],
  )

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
            <Button variant="outline" onClick={() => setIsCreateGroupDialogOpen(true)}>
              <FolderPlus className="size-4 mr-2" />
              {cs.topics.createGroup}
            </Button>
          </div>
        </div>
        <div className="relative mt-4 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-foreground-muted" />
          <Input
            type="text"
            placeholder={cs.topics.searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-input border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-6">
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="h-full">
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-5 rounded" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                  <Skeleton className="h-4 w-24 mt-1" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-full rounded-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : topics.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="size-12 text-foreground-muted mx-auto mb-4" />
              <p className="text-muted-foreground">{cs.topics.noTopics}</p>
            </CardContent>
          </Card>
        ) : (
          <RefreshOverlay isRefreshing={isRefreshing}>
            <div className="space-y-6">
              {groupsSorted.map((group, index) => renderGroupBox(group, index))}

              {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target for mouse drag-and-drop; keyboard DnD parity is a follow-up */}
              <div
                className={`rounded-xl border-2 p-4 transition-colors ${
                  isCarryingTopic && hoveredGroup === "unsorted"
                    ? "border-primary ring-2 ring-primary/40 bg-primary/5"
                    : isCarryingTopic
                      ? "border-primary border-dashed"
                      : groupsSorted.length > 0
                        ? "border-border"
                        : "border-transparent p-0"
                }`}
                onMouseEnter={() => {
                  if (isCarryingTopic) setHoveredGroup("unsorted")
                }}
                onMouseLeave={() => {
                  if (isCarryingTopic) setHoveredGroup(null)
                }}
                onMouseUp={() => {
                  if (isCarryingTopic) void handleDropTopicOnGroup(null)
                }}
              >
                {groupsSorted.length > 0 && (
                  <h3 className="font-semibold text-foreground mb-3">{cs.topics.unsorted}</h3>
                )}
                {unsortedTopics.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2 text-center">
                    {isCarryingTopic ? cs.topics.dropTopicHere : ""}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {unsortedTopics.map((topic) => renderTopicCard(topic))}
                  </div>
                )}
              </div>
            </div>
          </RefreshOverlay>
        )}
      </div>

      <CreateTopicDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreated={(topic) => navigate(`/topics/${topic.id}`)}
      />

      <CreateGroupDialog
        open={isCreateGroupDialogOpen}
        onOpenChange={setIsCreateGroupDialogOpen}
        onCreated={(group) => setGroups((prev) => [...prev, group])}
      />

      <DeleteConfirmDialog
        open={deletingGroup !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingGroup(null)
        }}
        onConfirm={() => void handleConfirmDeleteGroup()}
        title={cs.topics.deleteGroup}
        description={
          deletingGroup ? cs.topics.deleteGroupConfirm.replace("{name}", deletingGroup.name) : ""
        }
      />
    </div>
  )
}
