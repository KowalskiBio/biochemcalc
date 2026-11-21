import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import {
  type BiomoleculeTestQuestionSet,
  type BiomoleculeTestTeacherView,
  biomoleculesApi,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import { generatableQuizTypes } from "@/lib/molecules/quiz/question-generator"
import { testPairCount, testQuestionPool } from "@/lib/molecules/test"
import { stripRichMarkup } from "@/lib/rich-text"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.biomolekuly.testy

const TITLE_MAX = 120
/** Server-side cap, mirrored client-side so the form never posts a reject. */
const QUESTION_COUNT_MAX = 200

function formatWindowDate(value: string): string {
  return new Date(value).toLocaleString("cs-CZ", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** Question-count text with the Czech plural forms, shared with the hub. */
function questionCountText(count: number): string {
  const forms = testyStrings.questionCount
  const form = count === 1 ? forms.one : count >= 2 && count <= 4 ? forms.few : forms.many
  return form.replace("{count}", String(count))
}

/** The test's lifecycle phase, judged against the list payload's serverNow. */
function windowPhase(
  availableFrom: string,
  availableTo: string,
  serverNow: string,
): "upcoming" | "open" | "closed" {
  const now = new Date(serverNow).getTime()
  if (now < new Date(availableFrom).getTime()) return "upcoming"
  if (now > new Date(availableTo).getTime()) return "closed"
  return "open"
}

interface DraftState {
  title: string
  categorySlugs: string[]
  types: string[]
  countMode: "custom" | "all"
  countText: string
  questionSet: BiomoleculeTestQuestionSet
  monochrome: boolean
  fromLocal: string
  toLocal: string
}

function initialDraft(): DraftState {
  return {
    title: "",
    categorySlugs: [],
    types: [],
    countMode: "custom",
    countText: "10",
    questionSet: "random",
    monochrome: false,
    fromLocal: "",
    toLocal: "",
  }
}

export function BiomoleculesTestsPage() {
  const loaded = useBiomoleculeDataLoaded()
  const categories = useBiomoleculeDataStore((s) => s.categories)
  const topics = useBiomoleculeDataStore((s) => s.topics)
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)
  const { toast } = useToast()

  const [draft, setDraft] = useState<DraftState>(initialDraft)
  const [views, setViews] = useState<BiomoleculeTestTeacherView[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null)

  const loadTests = useCallback(async () => {
    setListError(null)
    try {
      setViews(await biomoleculesApi.biomoleculeTests())
    } catch (error) {
      setListError(extractErrorMessage(error, testyStrings.loadError))
      setViews((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    if (loaded) void loadTests()
  }, [loaded, loadTests])

  // Scope resolution: the checked categories, their molecules in store order.
  const scopedMolecules = useMemo(
    () => allMolecules.filter((molecule) => draft.categorySlugs.includes(molecule.categorySlug)),
    [allMolecules, draft.categorySlugs],
  )

  const pool = useMemo(() => {
    if (scopedMolecules.length === 0) return null
    return testQuestionPool(
      {
        categorySlugs: draft.categorySlugs,
        moleculeIds: scopedMolecules.map((molecule) => molecule.id),
      },
      allMolecules,
    )
  }, [scopedMolecules, draft.categorySlugs, allMolecules])

  const generatable = useMemo(
    () => (pool === null ? [] : generatableQuizTypes(pool.molecules, pool.characteristics)),
    [pool],
  )

  const pairCount = useMemo(
    () => (pool === null ? 0 : testPairCount(pool.molecules, pool.characteristics, draft.types)),
    [pool, draft.types],
  )

  const categoriesByTopic = useMemo(() => {
    const knownTopics = new Set(topics.map((topic) => topic.slug))
    const map = new Map<string, { slug: string; name: string }[]>()
    for (const category of categories) {
      const bucketKey =
        category.topicSlug != null && knownTopics.has(category.topicSlug)
          ? category.topicSlug
          : "__no_topic__"
      const bucket = map.get(bucketKey) ?? []
      bucket.push({ slug: category.slug, name: category.name })
      map.set(bucketKey, bucket)
    }
    return map
  }, [categories, topics])

  const toggleCategory = (slug: string) => {
    setDraft((current) => {
      const categorySlugs = current.categorySlugs.includes(slug)
        ? current.categorySlugs.filter((candidate) => candidate !== slug)
        : [...current.categorySlugs, slug]
      // Stale types drop out at create time (the payload uses the current
      // scope's intersection), so the draft can carry them harmlessly.
      return { ...current, categorySlugs }
    })
  }

  const toggleType = (type: string) => {
    setDraft((current) => {
      const types = current.types.includes(type)
        ? current.types.filter((candidate) => candidate !== type)
        : [...current.types, type]
      return { ...current, types }
    })
  }

  const fromIso = draft.fromLocal === "" ? null : new Date(draft.fromLocal).toISOString()
  const toIso = draft.toLocal === "" ? null : new Date(draft.toLocal).toISOString()
  const countCustomValue = Number.parseInt(draft.countText, 10)
  const resolvedCount =
    draft.countMode === "all" ? pairCount : Number.isNaN(countCustomValue) ? 0 : countCustomValue
  const formValid =
    draft.title.trim().length > 0 &&
    draft.title.trim().length <= TITLE_MAX &&
    draft.categorySlugs.length > 0 &&
    generatable.length > 0 &&
    draft.types.length > 0 &&
    resolvedCount >= 1 &&
    resolvedCount <= QUESTION_COUNT_MAX &&
    fromIso !== null &&
    toIso !== null &&
    new Date(fromIso).getTime() < new Date(toIso).getTime()

  const create = async () => {
    if (!formValid || creating) return
    setCreating(true)
    try {
      await biomoleculesApi.createBiomoleculeTest({
        title: draft.title.trim(),
        categorySlugs: [...draft.categorySlugs],
        moleculeIds: scopedMolecules.map((molecule) => molecule.id),
        questionTypes: draft.types.filter((type) => (generatable as string[]).includes(type)),
        questionCount: resolvedCount,
        questionSet: draft.questionSet,
        monochrome: draft.monochrome,
        availableFrom: fromIso ?? "",
        availableTo: toIso ?? "",
      })
      toast({ title: testyStrings.createSuccess })
      setDraft(initialDraft())
      await loadTests()
    } catch (error) {
      toast({
        title: testyStrings.createError,
        description: extractErrorMessage(error, testyStrings.createError),
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }

  const remove = async (testId: string) => {
    try {
      await biomoleculesApi.deleteBiomoleculeTest(testId)
      toast({ title: testyStrings.deleteSuccess })
      await loadTests()
    } catch (error) {
      toast({
        title: testyStrings.deleteError,
        description: extractErrorMessage(error, testyStrings.deleteError),
        variant: "destructive",
      })
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{testyStrings.teacherTitle}</h1>
        <p className="text-sm text-muted-foreground">{testyStrings.teacherDescription}</p>
      </div>

      {!loaded ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : (
        <>
          {/* Create form */}
          <Card>
            <CardHeader>
              <CardTitle>{testyStrings.createTitle}</CardTitle>
              <CardDescription>{testyStrings.createDescription}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="test-title">{testyStrings.titleLabel}</Label>
                <Input
                  id="test-title"
                  value={draft.title}
                  maxLength={TITLE_MAX}
                  placeholder={testyStrings.titlePlaceholder}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>{testyStrings.scopeLabel}</Label>
                <div className="max-h-64 space-y-3 overflow-y-auto rounded-[4px] border p-3">
                  {[...categoriesByTopic.entries()].map(([topicSlug, bucket]) => (
                    <div key={topicSlug} className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground">
                        {topicSlug === "__no_topic__"
                          ? testyStrings.scopeOtherTopic
                          : (topics.find((topic) => topic.slug === topicSlug)?.name ?? topicSlug)}
                      </p>
                      {bucket.map((category) => {
                        const checked = draft.categorySlugs.includes(category.slug)
                        return (
                          <label
                            key={category.slug}
                            className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-0.5 text-sm hover:bg-muted/40"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleCategory(category.slug)}
                              className="size-4 accent-[var(--primary)]"
                            />
                            <span>{stripRichMarkup(category.name)}</span>
                          </label>
                        )
                      })}
                    </div>
                  ))}
                </div>
                {scopedMolecules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{testyStrings.scopeEmpty}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {testyStrings.scopeSummary
                      .replace("{categories}", String(draft.categorySlugs.length))
                      .replace("{molecules}", String(scopedMolecules.length))}
                  </p>
                )}
              </div>

              {pool !== null && (
                <div className="space-y-2">
                  <Label>{testyStrings.typesLabel}</Label>
                  {generatable.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {testyStrings.noGeneratableTypes}
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {generatable.map((type) => {
                        const active = draft.types.includes(type)
                        return (
                          <button
                            key={type}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleType(type)}
                            className={`rounded-[4px] border px-3 py-1.5 text-sm transition-colors duration-150 ${
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "bg-card hover:border-primary/50"
                            }`}
                          >
                            {cs.biomolekuly.quiz.types[
                              type as keyof typeof cs.biomolekuly.quiz.types
                            ] ?? type}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {generatable.length > 0 && (
                <div className="space-y-2">
                  <Label>{testyStrings.countLabel}</Label>
                  <div className="flex items-center gap-4">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="count-mode"
                        checked={draft.countMode === "custom"}
                        onChange={() =>
                          setDraft((current) => ({ ...current, countMode: "custom" }))
                        }
                        className="size-4 accent-[var(--primary)]"
                      />
                      {testyStrings.countCustom}
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="count-mode"
                        checked={draft.countMode === "all"}
                        onChange={() => setDraft((current) => ({ ...current, countMode: "all" }))}
                        className="size-4 accent-[var(--primary)]"
                      />
                      {testyStrings.countAll}
                    </label>
                  </div>
                  {draft.countMode === "custom" ? (
                    <Input
                      type="number"
                      min={1}
                      max={QUESTION_COUNT_MAX}
                      value={draft.countText}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, countText: event.target.value }))
                      }
                      className="w-28"
                      aria-label={testyStrings.countLabel}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {pairCount > QUESTION_COUNT_MAX
                        ? testyStrings.countCap.replace("{count}", String(pairCount))
                        : testyStrings.countAllHint.replace("{count}", String(pairCount))}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>{testyStrings.questionSetLabel}</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    {
                      value: "fixed" as const,
                      label: testyStrings.questionSetFixed,
                      hint: testyStrings.questionSetFixedHint,
                    },
                    {
                      value: "random" as const,
                      label: testyStrings.questionSetRandom,
                      hint: testyStrings.questionSetRandomHint,
                    },
                  ].map((candidate) => (
                    <button
                      key={candidate.value}
                      type="button"
                      aria-pressed={draft.questionSet === candidate.value}
                      onClick={() =>
                        setDraft((current) => ({ ...current, questionSet: candidate.value }))
                      }
                      className={`rounded-[4px] border px-3 py-2 text-left transition-colors duration-150 ${
                        draft.questionSet === candidate.value
                          ? "border-primary bg-primary/10"
                          : "bg-card hover:border-primary/50"
                      }`}
                    >
                      <span className="block text-sm font-medium">{candidate.label}</span>
                      <span className="block text-xs text-muted-foreground">{candidate.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>{testyStrings.monochromeLabel}</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {[
                    {
                      value: false,
                      label: testyStrings.monochromeColor,
                      hint: testyStrings.monochromeColorHint,
                    },
                    {
                      value: true,
                      label: testyStrings.monochromeMono,
                      hint: testyStrings.monochromeMonoHint,
                    },
                  ].map((candidate) => (
                    <button
                      key={String(candidate.value)}
                      type="button"
                      aria-pressed={draft.monochrome === candidate.value}
                      onClick={() =>
                        setDraft((current) => ({ ...current, monochrome: candidate.value }))
                      }
                      className={`rounded-[4px] border px-3 py-2 text-left transition-colors duration-150 ${
                        draft.monochrome === candidate.value
                          ? "border-primary bg-primary/10"
                          : "bg-card hover:border-primary/50"
                      }`}
                    >
                      <span className="block text-sm font-medium">{candidate.label}</span>
                      <span className="block text-xs text-muted-foreground">{candidate.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="test-from">{testyStrings.availableFromLabel}</Label>
                  <Input
                    id="test-from"
                    type="datetime-local"
                    lang="cs-CZ"
                    value={draft.fromLocal}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, fromLocal: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="test-to">{testyStrings.availableToLabel}</Label>
                  <Input
                    id="test-to"
                    type="datetime-local"
                    lang="cs-CZ"
                    value={draft.toLocal}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, toLocal: event.target.value }))
                    }
                  />
                </div>
              </div>

              <Button onClick={() => void create()} disabled={!formValid || creating}>
                {creating ? testyStrings.creating : testyStrings.createAction}
              </Button>
            </CardContent>
          </Card>

          {/* Created tests */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold tracking-tight">{testyStrings.listTitle}</h2>
              <Button variant="outline" size="sm" onClick={() => void loadTests()}>
                {testyStrings.refresh}
              </Button>
            </div>

            {listError !== null && <p className="text-sm text-destructive">{listError}</p>}

            {views === null ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : views.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center">
                  <p className="font-medium">{testyStrings.listEmptyTitle}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {testyStrings.listEmptyDescription}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {views.map((view) => {
                  const phase = windowPhase(
                    view.test.availableFrom,
                    view.test.availableTo,
                    view.serverNow,
                  )
                  const phaseLabel =
                    phase === "upcoming"
                      ? testyStrings.stateUpcoming
                      : phase === "open"
                        ? testyStrings.stateOpen
                        : testyStrings.stateClosed
                  const submitted = view.attempts.filter(
                    (attempt) => attempt.submittedAt !== null,
                  ).length
                  const expanded = expandedId === view.test.id
                  return (
                    <Card key={view.test.id}>
                      <CardHeader className="space-y-2">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <CardTitle className="text-lg leading-snug">{view.test.title}</CardTitle>
                          <Badge
                            variant="outline"
                            className={
                              phase === "open" ? "border-accent/40 text-accent" : undefined
                            }
                          >
                            {phaseLabel}
                          </Badge>
                        </div>
                        <CardDescription className="space-y-1">
                          <span className="block">
                            {testyStrings.windowLabel}: {formatWindowDate(view.test.availableFrom)}{" "}
                            – {formatWindowDate(view.test.availableTo)}
                          </span>
                          <span className="block">
                            {questionCountText(view.test.questionCount)}
                          </span>
                        </CardDescription>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">
                            {view.test.questionSet === "fixed"
                              ? testyStrings.fixedBadge
                              : testyStrings.randomBadge}
                          </Badge>
                          <Badge variant="secondary">
                            {view.test.monochrome
                              ? testyStrings.monoBadge
                              : testyStrings.colorBadge}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm text-muted-foreground">
                            {testyStrings.submittedProgress
                              .replace("{submitted}", String(submitted))
                              .replace(
                                "{total}",
                                String(
                                  view.roster.length +
                                    view.attempts.filter(
                                      (attempt) =>
                                        !view.roster.some(
                                          (student) => student.userId === attempt.userId,
                                        ),
                                    ).length,
                                ),
                              )}
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExpandedId(expanded ? null : view.test.id)}
                            >
                              {expanded
                                ? testyStrings.collapseStudents
                                : testyStrings.expandStudents}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setDeleting({
                                  id: view.test.id,
                                  title: stripRichMarkup(view.test.title),
                                })
                              }
                            >
                              {testyStrings.deleteAction}
                            </Button>
                          </div>
                        </div>

                        {expanded && <AttemptRows view={view} />}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {deleting !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null)
          }}
          title={testyStrings.deleteTitle}
          description={testyStrings.deleteConfirm.replace(
            "{title}",
            stripRichMarkup(deleting.title),
          )}
          confirmLabel={testyStrings.deleteAction}
          cancelLabel={testyStrings.cancel}
          onConfirm={() => {
            const id = deleting.id
            setDeleting(null)
            void remove(id)
          }}
        />
      )}
    </div>
  )
}

function AttemptRows({ view }: { view: BiomoleculeTestTeacherView }) {
  const byUser = new Map(view.attempts.map((attempt) => [attempt.userId, attempt]))
  // Roster first (never-submitted students visible), then stray attempts
  // whose user left the roster.
  const rows = [
    ...view.roster.map((student) => ({
      key: student.userId,
      username: student.username,
      attempt: byUser.get(student.userId) ?? null,
    })),
    ...view.attempts
      .filter((attempt) => !view.roster.some((student) => student.userId === attempt.userId))
      .map((attempt) => ({
        key: attempt.userId,
        username: attempt.username,
        attempt,
      })),
  ]

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{testyStrings.noStudents}</p>
  }

  return (
    <div className="overflow-x-auto rounded-[4px] border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            <th className="px-3 py-2 font-medium">{testyStrings.studentColumn}</th>
            <th className="px-3 py-2 font-medium">{testyStrings.statusColumn}</th>
            <th className="px-3 py-2 font-medium">{testyStrings.submittedAtColumn}</th>
            <th className="px-3 py-2 text-right font-medium">{testyStrings.scoreColumn}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const attempt = row.attempt
            const status =
              attempt === null
                ? testyStrings.notSubmitted
                : attempt.submittedAt !== null
                  ? testyStrings.statusSubmitted
                  : testyStrings.statusInProgress
            return (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="px-3 py-2">{row.username}</td>
                <td className="px-3 py-2">{status}</td>
                <td className="px-3 py-2 font-mono tabular text-xs text-muted-foreground">
                  {attempt !== null && attempt.submittedAt !== null
                    ? formatWindowDate(attempt.submittedAt)
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular">
                  {attempt !== null && attempt.submittedAt !== null
                    ? `${attempt.correctCount ?? 0} / ${attempt.totalCount ?? 0}`
                    : "—"}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
