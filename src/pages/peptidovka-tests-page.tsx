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
  biomoleculesApi,
  type PeptidovkaTestQuestionSet,
  type PeptidovkaTestTeacherView,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import { PEPTIDE_FAMILY_SLUGS, TRAIT, traitOf } from "@/lib/molecules"
import { stripRichMarkup } from "@/lib/rich-text"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.peptidovka.testy

const TITLE_MAX = 120
/** Server-side bounds, mirrored client-side so the form never posts a reject. */
const PEPTIDE_COUNT_MAX = 20
const PEPTIDE_LENGTH_MIN = 2
const PEPTIDE_LENGTH_MAX = 20

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
  const forms = testyStrings.peptideCount
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
  poolSlugs: string[]
  countText: string
  lengthText: string
  questionSet: PeptidovkaTestQuestionSet
  monochrome: boolean
  fromLocal: string
  toLocal: string
}

function initialDraft(): DraftState {
  return {
    title: "",
    poolSlugs: [],
    countText: "5",
    lengthText: "4",
    questionSet: "random",
    monochrome: false,
    fromLocal: "",
    toLocal: "",
  }
}

export function PeptidovkaTestsPage() {
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)
  const { toast } = useToast()

  const [draft, setDraft] = useState<DraftState>(initialDraft)
  const [views, setViews] = useState<PeptidovkaTestTeacherView[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null)

  // The peptidovka-playable amino acids: the same rule the game's run page
  // uses — a molecule in a peptide family category carrying a one-letter code.
  const pool = useMemo(
    () =>
      allMolecules.filter(
        (molecule) =>
          PEPTIDE_FAMILY_SLUGS.includes(molecule.categorySlug) &&
          (traitOf(molecule, TRAIT.oneLetter) ?? "").trim() !== "",
      ),
    [allMolecules],
  )

  const loadTests = useCallback(async () => {
    setListError(null)
    try {
      setViews(await biomoleculesApi.peptidovkaTests())
    } catch (error) {
      setListError(extractErrorMessage(error, testyStrings.loadError))
      setViews((current) => current ?? [])
    }
  }, [])

  useEffect(() => {
    if (loaded) void loadTests()
  }, [loaded, loadTests])

  const togglePool = (slug: string) => {
    setDraft((current) => {
      const poolSlugs = current.poolSlugs.includes(slug)
        ? current.poolSlugs.filter((candidate) => candidate !== slug)
        : [...current.poolSlugs, slug]
      return { ...current, poolSlugs }
    })
  }

  const count = Number.parseInt(draft.countText, 10)
  const length = Number.parseInt(draft.lengthText, 10)
  const fromIso = draft.fromLocal === "" ? null : new Date(draft.fromLocal).toISOString()
  const toIso = draft.toLocal === "" ? null : new Date(draft.toLocal).toISOString()
  const formValid =
    draft.title.trim().length > 0 &&
    draft.title.trim().length <= 120 &&
    draft.poolSlugs.length >= 2 &&
    Number.isInteger(count) &&
    count >= 1 &&
    count <= PEPTIDE_COUNT_MAX &&
    Number.isInteger(length) &&
    length >= PEPTIDE_LENGTH_MIN &&
    length <= PEPTIDE_LENGTH_MAX &&
    fromIso !== null &&
    toIso !== null &&
    new Date(fromIso).getTime() < new Date(toIso).getTime()

  const invalidMessage = !formValid
    ? draft.poolSlugs.length < 2
      ? testyStrings.poolEmpty
      : !Number.isInteger(count) || count < 1 || count > PEPTIDE_COUNT_MAX
        ? testyStrings.invalidCount
        : !Number.isInteger(length) || length < PEPTIDE_LENGTH_MIN || length > PEPTIDE_LENGTH_MAX
          ? testyStrings.invalidLength
          : fromIso === null ||
              toIso === null ||
              new Date(fromIso).getTime() >= new Date(toIso).getTime()
            ? testyStrings.windowInvalid
            : null
    : null

  const create = async () => {
    if (!formValid || creating) return
    setCreating(true)
    try {
      await biomoleculesApi.createPeptidovkaTest({
        title: draft.title.trim(),
        poolSlugs: draft.poolSlugs,
        peptideCount: count,
        peptideLength: length,
        questionSet: draft.questionSet,
        monochrome: draft.monochrome,
        availableFrom: fromIso ?? "",
        availableTo: toIso ?? "",
      })
      toast({ title: testyStrings.createSuccess })
      setDraft((current) => ({ ...initialDraft(), poolSlugs: current.poolSlugs }))
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
      await biomoleculesApi.deletePeptidovkaTest(testId)
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
                <Label htmlFor="peptide-test-title">{testyStrings.titleLabel}</Label>
                <Input
                  id="peptide-test-title"
                  value={draft.title}
                  maxLength={TITLE_MAX}
                  placeholder={testyStrings.titlePlaceholder}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>{testyStrings.poolLabel}</Label>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                  {pool.map((molecule) => {
                    const checked = draft.poolSlugs.includes(molecule.slug)
                    const oneLetter = traitOf(molecule, TRAIT.oneLetter) ?? ""
                    return (
                      <label
                        key={molecule.slug}
                        className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-0.5 text-sm hover:bg-muted/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePool(molecule.slug)}
                          className="size-4 accent-[var(--primary)]"
                        />
                        <span>{stripRichMarkup(molecule.name)}</span>
                        <span className="ml-auto font-mono text-xs text-muted-foreground">
                          {stripRichMarkup(oneLetter)}
                        </span>
                      </label>
                    )
                  })}
                </div>
                {draft.poolSlugs.length < 2 ? (
                  <p className="text-xs text-muted-foreground">{testyStrings.poolEmpty}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {testyStrings.poolSummary.replace("{count}", String(draft.poolSlugs.length))}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="peptide-count">{testyStrings.peptideCountLabel}</Label>
                  <Input
                    id="peptide-count"
                    type="number"
                    min={1}
                    max={PEPTIDE_COUNT_MAX}
                    value={draft.countText}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, countText: event.target.value }))
                    }
                    className="w-28"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="peptide-length">{testyStrings.peptideLengthLabel}</Label>
                  <Input
                    id="peptide-length"
                    type="number"
                    min={PEPTIDE_LENGTH_MIN}
                    max={PEPTIDE_LENGTH_MAX}
                    value={draft.lengthText}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, lengthText: event.target.value }))
                    }
                    className="w-28"
                  />
                </div>
              </div>

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
                  <Label htmlFor="peptide-test-from">{testyStrings.availableFromLabel}</Label>
                  <Input
                    id="peptide-test-from"
                    type="datetime-local"
                    lang="cs-CZ"
                    value={draft.fromLocal}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, fromLocal: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="peptide-test-to">{testyStrings.availableToLabel}</Label>
                  <Input
                    id="peptide-test-to"
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
                          <span className="block">{questionCountText(view.test.peptideCount)}</span>
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

function AttemptRows({ view }: { view: PeptidovkaTestTeacherView }) {
  const byUser = new Map(view.attempts.map((attempt) => [attempt.userId, attempt]))
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
