import { useCallback, useEffect, useMemo, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RichText } from "@/components/ui/rich-text"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import {
  type Biomolecule,
  type BiomoleculeTest,
  type BiomoleculeTestQuestionSet,
  type BiomoleculeTestsTeacherPage,
  type BiomoleculeTestTeacherView,
  biomoleculesApi,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import {
  generatableQuizTypes,
  type QuizOption,
  type QuizQuestion,
} from "@/lib/molecules/quiz/question-generator"
import { generateTestSession, testPairCount, testQuestionPool } from "@/lib/molecules/test"
import { stripRichMarkup } from "@/lib/rich-text"
import { cn } from "@/lib/utils"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.biomolekuly.testy
const quizStrings = cs.biomolekuly.quiz

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

function questionCountText(count: number): string {
  const forms = testyStrings.questionCount
  const form = count === 1 ? forms.one : count >= 2 && count <= 4 ? forms.few : forms.many
  return form.replace("{count}", String(count))
}

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
  audienceMode: "all" | "codes"
  assignedCodes: string[]
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
    audienceMode: "all",
    assignedCodes: [],
    questionSet: "random",
    monochrome: false,
    fromLocal: "",
    toLocal: "",
  }
}

export function BiomoleculesTestsPage() {
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)
  const categories = useBiomoleculeDataStore((s) => s.categories)
  const topics = useBiomoleculeDataStore((s) => s.topics)
  const { toast } = useToast()

  const [draft, setDraft] = useState<DraftState>(initialDraft)
  const [page, setPage] = useState<BiomoleculeTestsTeacherPage | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailAttempt, setDetailAttempt] = useState<{
    testId: string
    username: string
    attempt: {
      attemptId: string
      seed: number
      submittedAt: string | null
      totalCount: number | null
      correctCount: number | null
      detailJson: string | null
    }
  } | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null)

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
    (draft.audienceMode === "all" || draft.assignedCodes.length > 0) &&
    fromIso !== null &&
    toIso !== null &&
    new Date(fromIso).getTime() < new Date(toIso).getTime()

  const loadTests = useCallback(async () => {
    setListError(null)
    try {
      setPage(await biomoleculesApi.biomoleculeTests())
    } catch (error) {
      setListError(extractErrorMessage(error, testyStrings.loadError))
      setPage((current) => current ?? { tests: [], codes: [], serverNow: new Date().toISOString() })
    }
  }, [])

  useEffect(() => {
    if (loaded) void loadTests()
  }, [loaded, loadTests])

  const invalidMessage = !formValid
    ? draft.categorySlugs.length === 0 || draft.types.length === 0
      ? testyStrings.scopeEmpty
      : resolvedCount < 1 || resolvedCount > QUESTION_COUNT_MAX
        ? testyStrings.countInvalid
        : draft.audienceMode === "codes" && draft.assignedCodes.length === 0
          ? testyStrings.audienceEmpty
          : null
    : null

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
        assignedCodes: draft.audienceMode === "all" ? [] : draft.assignedCodes,
        questionSet: draft.questionSet,
        monochrome: draft.monochrome,
        availableFrom: fromIso ?? "",
        availableTo: toIso ?? "",
      })
      toast({ title: testyStrings.createSuccess })
      // Keep the audience, scope and window — repeat tests usually share
      // them, and the preserved fields keep the form valid so a success never
      // reads like a failure.
      setDraft((current) => ({
        ...initialDraft(),
        categorySlugs: current.categorySlugs,
        types: current.types,
        audienceMode: current.audienceMode,
        assignedCodes: current.assignedCodes,
        fromLocal: current.fromLocal,
        toLocal: current.toLocal,
      }))
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
                            {quizStrings.types[type as keyof typeof quizStrings.types] ?? type}
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

              <div className="space-y-2">
                <Label>{testyStrings.audienceLabel}</Label>
                <div className="flex items-center gap-4">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="audience-mode"
                      checked={draft.audienceMode === "all"}
                      onChange={() => setDraft((current) => ({ ...current, audienceMode: "all" }))}
                      className="size-4 accent-[var(--primary)]"
                    />
                    {testyStrings.audienceAll}
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="audience-mode"
                      checked={draft.audienceMode === "codes"}
                      onChange={() =>
                        setDraft((current) => ({ ...current, audienceMode: "codes" }))
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    {testyStrings.audienceCodes}
                  </label>
                </div>
                {draft.audienceMode === "codes" && (
                  <div className="max-h-40 space-y-1 overflow-y-auto rounded-[4px] border p-2">
                    {(page?.codes ?? []).map((entry) => {
                      const checked = draft.assignedCodes.includes(entry.code)
                      return (
                        <label
                          key={entry.code}
                          className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-0.5 text-sm hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDraft((current) => {
                                const assignedCodes = current.assignedCodes.includes(entry.code)
                                  ? current.assignedCodes.filter(
                                      (candidate) => candidate !== entry.code,
                                    )
                                  : [...current.assignedCodes, entry.code]
                                return { ...current, assignedCodes }
                              })
                            }
                            className="size-4 accent-[var(--primary)]"
                          />
                          <span className="font-mono text-xs">{entry.code}</span>
                          <span className="ml-auto text-xs text-muted-foreground">
                            {entry.studentCount}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
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

              {invalidMessage !== null && (
                <p className="text-sm text-destructive">{invalidMessage}</p>
              )}

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

            {page === null ? (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : page.tests.length === 0 ? (
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
                {page.tests.map((view) => {
                  const phase = windowPhase(
                    view.test.availableFrom,
                    view.test.availableTo,
                    page.serverNow,
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
                          <span className="block">
                            {view.test.assignedCodes.length === 0
                              ? testyStrings.audienceAllBadge
                              : testyStrings.audienceCodesBadge.replace(
                                  "{count}",
                                  String(view.test.assignedCodes.length),
                                )}
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

                        {expanded && (
                          <AttemptRows
                            view={view}
                            onDetail={(attempt) =>
                              setDetailAttempt({
                                testId: view.test.id,
                                username: attempt.username,
                                attempt,
                              })
                            }
                          />
                        )}
                        {detailAttempt !== null && detailAttempt.testId === view.test.id && (
                          <BiomoleculeAttemptDetail
                            test={view.test}
                            username={detailAttempt.username}
                            attempt={detailAttempt.attempt}
                            allMolecules={allMolecules}
                          />
                        )}
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
          description={testyStrings.deleteConfirm.replace("{title}", deleting.title)}
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

interface AttemptRowsProps {
  view: BiomoleculeTestTeacherView
  onDetail: (attempt: {
    attemptId: string
    userId: string
    username: string
    seed: number
    submittedAt: string | null
    totalCount: number | null
    correctCount: number | null
    detailJson: string | null
  }) => void
}

function AttemptRows({ view, onDetail }: AttemptRowsProps) {
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
            <th className="px-3 py-2" aria-label={testyStrings.expandStudents} />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const attempt = row.attempt
            const submitted = attempt !== null && attempt.submittedAt !== null
            const status =
              attempt === null
                ? testyStrings.notSubmitted
                : submitted
                  ? testyStrings.statusSubmitted
                  : testyStrings.statusInProgress
            return (
              <tr key={row.key} className="border-b last:border-b-0">
                <td className="px-3 py-2">{row.username}</td>
                <td className="px-3 py-2">{status}</td>
                <td className="px-3 py-2 font-mono tabular text-xs text-muted-foreground">
                  {submitted ? formatWindowDate(attempt?.submittedAt ?? "") : "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular">
                  {submitted ? `${attempt.correctCount ?? 0} / ${attempt.totalCount ?? 0}` : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {submitted && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onDetail(attempt)}
                      aria-label={`${testyStrings.expandStudents}: ${row.username}`}
                    >
                      {testyStrings.expandStudents}
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

interface AttemptSummaryLike {
  attemptId: string
  seed: number
  submittedAt: string | null
  totalCount: number | null
  correctCount: number | null
  detailJson: string | null
}

/**
 * One student's submitted test, reconstructed for the teacher: the batch
 * regenerates from the attempt seed and the stored per-question answers
 * (matched by uid) mark exactly what the student picked.
 */
function BiomoleculeAttemptDetail({
  test,
  username,
  attempt,
  allMolecules,
}: {
  test: BiomoleculeTest
  username: string
  attempt: AttemptSummaryLike
  allMolecules: Biomolecule[]
}) {
  const molecules = useMemo(
    () => testQuestionPool(test, allMolecules)?.molecules ?? [],
    [test, allMolecules],
  )
  const rows = useMemo(() => {
    const questions = generateTestSession(test, attempt.seed, allMolecules)
    if (questions === null || questions.length === 0 || attempt.detailJson === null) {
      return null
    }
    let answers: { uid: string; correct: boolean; selectedKey: string | null }[]
    try {
      const parsed = JSON.parse(attempt.detailJson) as {
        answers?: { uid: string; correct: boolean; selectedKey: string | null }[]
      }
      answers = parsed.answers ?? []
    } catch {
      return null
    }
    if (answers.length !== questions.length) {
      return null
    }
    const result: { question: QuizQuestion; selectedKey: string | null; correct: boolean }[] = []
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index] as QuizQuestion
      const answer = answers[index]
      if (answer === undefined || answer.uid !== (question.uid ?? "")) {
        return null // dataset drift: the stored answers no longer line up
      }
      result.push({ question, selectedKey: answer.selectedKey, correct: answer.correct })
    }
    return result
  }, [test, attempt.seed, attempt.detailJson, allMolecules])

  if (rows === null) {
    return <p className="text-sm text-muted-foreground">{testyStrings.detailUnavailable}</p>
  }

  const optionLabel = (option: QuizOption): string => {
    const molecule = molecules.find((m) => m.id === option.moleculeId)
    if (!molecule) return option.key
    return option.display === "letter" ? (molecule.oneLetter ?? option.key) : molecule.name
  }

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">{username}</p>
      <ol className="space-y-3">
        {rows.map((row, index) => {
          const picked = row.selectedKey
            ? (row.question.options.find((option) => option.key === row.selectedKey) ?? null)
            : null
          return (
            <li key={row.question.uid ?? index} className="rounded-[4px] border p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {testyStrings.questionNumber.replace("{number}", String(index + 1))} ·{" "}
                  {quizStrings.types[row.question.type as keyof typeof quizStrings.types] ??
                    row.question.type}
                </p>
                <span
                  className={cn(
                    "font-mono tabular text-xs font-semibold",
                    row.correct ? "text-accent" : "text-destructive",
                  )}
                >
                  {row.correct ? quizStrings.correct : quizStrings.incorrect}
                </span>
              </div>
              {row.question.prompt.kind === "structure" && row.question.prompt.smiles ? (
                <div className="mt-2 flex min-w-0 justify-center">
                  <StructureView
                    smiles={row.question.prompt.smiles}
                    projection={row.question.prompt.projection}
                    haworth={row.question.prompt.haworth ?? true}
                    fischer={row.question.prompt.fischer ?? true}
                    orientationDeg={row.question.prompt.orientationDeg}
                    size={180}
                    monochrome={test.monochrome}
                    title={quizStrings.promptStructureLabel}
                    className="max-w-full"
                  />
                </div>
              ) : row.question.prompt.kind === "letter" ? (
                <p className="mt-2 text-center font-mono tabular text-2xl font-semibold tracking-tight">
                  {row.question.prompt.text}
                </p>
              ) : row.question.prompt.kind === "characteristic" ? (
                <p className="mt-2 text-center text-lg font-semibold tracking-tight">
                  {row.question.prompt.predicate
                    ? quizStrings.characteristicPrompts[row.question.prompt.predicate]
                    : row.question.prompt.text}
                </p>
              ) : (
                <p className="mt-2 text-center text-xl font-semibold tracking-tight">
                  <RichText text={row.question.prompt.text} />
                </p>
              )}
              <ul className="mt-3 space-y-1.5">
                {row.question.options.map((option) => {
                  const isPicked = picked !== null && picked.key === option.key
                  const label = option.display === "structure" ? "" : optionLabel(option)
                  return (
                    <li
                      key={option.key}
                      className={cn(
                        "flex items-center gap-2 rounded-[4px] border px-3 py-1.5 text-sm",
                        option.correct
                          ? "border-accent/60 bg-accent/5 text-accent"
                          : isPicked
                            ? "border-destructive/60 bg-destructive/5 text-destructive"
                            : "border-border text-muted-foreground",
                      )}
                    >
                      {option.display === "structure" ? (
                        <div aria-hidden="true">
                          <StructureView
                            smiles={option.smiles ?? ""}
                            projection={option.projection}
                            haworth={option.haworth ?? true}
                            fischer={option.fischer ?? true}
                            orientationDeg={option.orientationDeg}
                            size={120}
                            monochrome={test.monochrome}
                          />
                        </div>
                      ) : (
                        <RichText text={label} />
                      )}
                      {option.correct && (
                        <span className="ml-auto text-xs font-medium">
                          {testyStrings.correctOption}
                        </span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
