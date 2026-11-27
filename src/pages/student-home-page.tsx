import { ArrowRight, Atom, ClipboardList, Flag, FlaskConical, Timer, Trophy } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import {
  AssignedTestCard,
  AssignedTestsSkeleton,
  isAssignedTestOpen,
  useAssignedTests,
  useOpenAssignedTest,
} from "@/components/biomolecules/assigned-tests"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { RichText } from "@/components/ui/rich-text"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { allowedSections, useSection } from "@/hooks/use-section"
import { cs } from "@/i18n/cs"
import { type Biomolecule, biomoleculesApi } from "@/lib/biomolecules-api"
import { fnv1a } from "@/lib/fnv1a"
import { moleculeFacts, TRAIT, traitOf } from "@/lib/molecules"
import { parseProjection } from "@/lib/molecules/render/projection"
import { studentApi } from "@/lib/student-api"
import type { Section, TestKind, TestTopicOption } from "@/lib/types"
import { useAuthStore } from "@/stores/auth-store"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useCategoryNames,
} from "@/stores/biomolecule-data-store"

const homeStrings = cs.studentHome

function SectionHeading({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Trophy
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="space-y-0.5">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground">
          <Icon className="size-5 text-primary" strokeWidth={1.75} />
          {title}
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Open tests
// ---------------------------------------------------------------------------

interface PracticeTestOffer {
  kind: TestKind
  topic: TestTopicOption
}

/** The calculations section's timed practice tests a student can sit right now. */
function usePracticeTestOffers(enabled: boolean) {
  const [offers, setOffers] = useState<PracticeTestOffer[] | null>(enabled ? null : [])
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const kinds: TestKind[] = ["uvodni", "prubezny"]
    Promise.allSettled(kinds.map((kind) => studentApi.testTopics(kind))).then((results) => {
      if (cancelled) return
      const merged: PracticeTestOffer[] = []
      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          for (const topic of result.value) merged.push({ kind: kinds[index], topic })
        } else {
          setFailed(true)
        }
      })
      setOffers(merged)
    })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return { offers, failed }
}

function PracticeTestRow({ offer }: { offer: PracticeTestOffer }) {
  const Icon = offer.kind === "uvodni" ? Flag : Timer
  const title = offer.kind === "uvodni" ? cs.test.modeUvodniTitle : cs.test.modePrubeznyTitle
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div className="min-w-0 space-y-1">
          <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <FlaskConical className="size-3" strokeWidth={1.75} />
            {homeStrings.kindCalculations}
          </p>
          <p className="flex items-center gap-2 font-medium">
            <Icon className="size-4 shrink-0 text-primary" strokeWidth={1.75} />
            <span className="truncate">{offer.topic.name}</span>
          </p>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline">{homeStrings.practiceTestBadge}</Badge>
          <Button asChild>
            <Link to={`/test/${offer.kind}?tema=${encodeURIComponent(offer.topic.id)}`}>
              {homeStrings.practiceTestStart}
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function OpenTests({ allowed }: { allowed: Section[] }) {
  const hasBiomolecules = allowed.includes("biomolecules")
  const hasCalculations = allowed.includes("calculations")
  const { tests, loadError, reload } = useAssignedTests(hasBiomolecules)
  const { open, openingId } = useOpenAssignedTest(reload)
  const { offers, failed } = usePracticeTestOffers(hasCalculations)

  // Assigned tests first (they have deadlines), then the always-on practice tests.
  const assignedOpen = (tests ?? []).filter(isAssignedTestOpen)
  const loading = tests === null || offers === null
  const empty = !loading && assignedOpen.length === 0 && (offers ?? []).length === 0

  return (
    <section className="space-y-4" aria-labelledby="home-open-tests">
      <div id="home-open-tests">
        <SectionHeading
          icon={ClipboardList}
          title={homeStrings.openTestsTitle}
          description={homeStrings.openTestsDescription}
        />
      </div>

      {(loadError || failed) && (
        <p className="text-sm text-destructive">{loadError ?? homeStrings.openTestsError}</p>
      )}

      {loading ? (
        <AssignedTestsSkeleton count={1} />
      ) : empty ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="font-medium">{homeStrings.openTestsEmpty}</p>
            <p className="mt-1 text-sm text-muted-foreground">{homeStrings.openTestsEmptyHint}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignedOpen.map((item) => (
            <AssignedTestCard
              key={`${item.kind}-${item.view.test.id}`}
              item={item}
              openingId={openingId}
              onOpen={(next) => void open(next)}
            />
          ))}
          {(offers ?? []).map((offer) => (
            <PracticeTestRow key={`${offer.kind}-${offer.topic.id}`} offer={offer} />
          ))}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Leaderboard standings
// ---------------------------------------------------------------------------

interface Standing {
  label: string
  /** 1-based rank, or null when the student isn't on the board yet. */
  rank: number | null
  total: number
  value: string | null
}

interface BoardSource {
  label: string
  load: () => Promise<{ userId: string; value: number }[]>
  format: (value: number) => string
}

function boardsFor(section: Section): BoardSource[] {
  const values = homeStrings.values
  const boards = homeStrings.boards
  const correct = (count: number) => values.correct.replace("{count}", String(count))
  const points = (count: number) => values.points.replace("{count}", String(count))
  const streak = (count: number) => values.streak.replace("{count}", String(count))
  const bestRuns = (rows: { userId: string; bestCorrectCount: number }[]) =>
    rows.map((row) => ({ userId: row.userId, value: row.bestCorrectCount }))

  if (section === "calculations") {
    return [
      {
        label: boards.calculationsPractice,
        load: async () =>
          (await studentApi.leaderboard()).map((row) => ({
            userId: row.userId,
            value: row.correctCount,
          })),
        format: correct,
      },
      {
        label: boards.calculationsMaster,
        load: async () => bestRuns(await studentApi.streakLeaderboard({ kind: "master" })),
        format: streak,
      },
    ]
  }
  return [
    {
      label: boards.biomoleculesQuiz,
      load: async () =>
        (await biomoleculesApi.leaderboard()).map((row) => ({
          userId: row.userId,
          value: row.points,
        })),
      format: points,
    },
    {
      label: boards.biomoleculesApprentice,
      load: async () => bestRuns(await biomoleculesApi.streakLeaderboard("apprentice")),
      format: streak,
    },
    {
      label: boards.biomoleculesMaster,
      load: async () => bestRuns(await biomoleculesApi.streakLeaderboard("master")),
      format: streak,
    },
    {
      label: boards.peptidovkaUcen,
      load: async () => bestRuns(await biomoleculesApi.peptidovkaLeaderboard("ucen")),
      format: streak,
    },
    {
      label: boards.peptidovkaMistr,
      load: async () => bestRuns(await biomoleculesApi.peptidovkaLeaderboard("mistr")),
      format: streak,
    },
  ]
}

/**
 * The student's place on each board of the current section. Boards come
 * ranked from the server, so a rank is the student's row index + 1.
 */
function Standings({ section }: { section: Section }) {
  const userId = useAuthStore((s) => s.user?.id)
  const [standings, setStandings] = useState<(Standing | null)[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setStandings(null)
    const sources = boardsFor(section)
    Promise.allSettled(sources.map((source) => source.load())).then((results) => {
      if (cancelled) return
      setStandings(
        results.map((result, index) => {
          if (result.status === "rejected") return null
          const source = sources[index]
          const rows = result.value
          const position = rows.findIndex((row) => row.userId === userId)
          return {
            label: source.label,
            rank: position >= 0 ? position + 1 : null,
            total: rows.length,
            value: position >= 0 ? source.format(rows[position].value) : null,
          }
        }),
      )
    })
    return () => {
      cancelled = true
    }
  }, [section, userId])

  return (
    <section className="space-y-4" aria-labelledby="home-standings">
      <div id="home-standings">
        <SectionHeading
          icon={Trophy}
          title={homeStrings.leaderboardTitle}
          description={homeStrings.leaderboardDescription}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to="/leaderboard">
                {homeStrings.leaderboardLink}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {standings === null
          ? boardsFor(section).map((board) => (
              <Skeleton key={board.label} className="h-[92px] rounded-[4px]" />
            ))
          : standings.map((standing, index) =>
              standing === null ? (
                <Card key={boardsFor(section)[index].label}>
                  <CardContent className="space-y-1 py-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {boardsFor(section)[index].label}
                    </p>
                    <p className="text-sm text-destructive">{homeStrings.leaderboardError}</p>
                  </CardContent>
                </Card>
              ) : (
                <Card key={standing.label}>
                  <CardContent className="space-y-1 py-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {standing.label}
                    </p>
                    {standing.rank === null ? (
                      <p className="text-sm text-muted-foreground">
                        {homeStrings.leaderboardNoResult}
                      </p>
                    ) : (
                      <>
                        <p className="font-mono tabular text-2xl font-semibold tracking-tight text-foreground">
                          {standing.rank}.
                          <span className="ml-1.5 text-sm font-normal text-muted-foreground">
                            {homeStrings.leaderboardRankOf.replace(
                              "{total}",
                              String(standing.total),
                            )}
                          </span>
                        </p>
                        <p className="font-mono tabular text-sm text-accent">{standing.value}</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              ),
            )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Molecule of the day
// ---------------------------------------------------------------------------

/** Today's date in Prague as YYYY-MM-DD, so everyone's "day" turns over together. */
function todayKey(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Prague" }).format(new Date())
}

/** One molecule per day, the same for every student: the date hash picks it. */
function pickMoleculeOfDay(molecules: Biomolecule[], day: string): Biomolecule | null {
  const candidates = molecules.filter((molecule) => molecule.smiles.trim().length > 0)
  if (candidates.length === 0) return null
  // Stable order regardless of library order changes within the day.
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id))
  return sorted[Number.parseInt(fnv1a(day), 16) % sorted.length]
}

function MoleculeOfDay({ canBrowse }: { canBrowse: boolean }) {
  const loaded = useBiomoleculeDataLoaded()
  const molecules = useBiomoleculeDataStore((s) => s.molecules)
  const nameOf = useCategoryNames()
  const day = todayKey()
  const molecule = useMemo(() => pickMoleculeOfDay(molecules, day), [molecules, day])

  const abbreviation = molecule ? traitOf(molecule, TRAIT.abbreviation) : undefined
  const oneLetter = molecule ? traitOf(molecule, TRAIT.oneLetter) : undefined
  const fact = molecule ? moleculeFacts(molecule)[0] : undefined
  const code = [abbreviation, oneLetter].filter(Boolean).join(" · ")
  const haworthOk = molecule?.haworth ?? true
  const projection = useMemo(
    () => (haworthOk ? (parseProjection(molecule?.projection) ?? undefined) : undefined),
    [molecule, haworthOk],
  )

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <Atom className="size-3" strokeWidth={1.75} />
          {homeStrings.moleculeOfDayTitle}
        </p>
        {molecule && (
          <>
            <CardTitle className="text-xl">
              <RichText text={molecule.name} />
            </CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-2">
              <span>
                <RichText text={nameOf(molecule.categorySlug)} />
              </span>
              {code && <span className="font-mono tabular">{code}</span>}
            </CardDescription>
          </>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <Skeleton className="h-[220px] rounded-[4px]" />
        ) : molecule === null ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {homeStrings.moleculeOfDayEmpty}
          </p>
        ) : (
          <>
            <div className="flex justify-center rounded-[4px] border bg-background/60 p-3">
              <StructureView
                smiles={molecule.smiles}
                projection={projection}
                haworth={haworthOk}
                fischer={molecule.fischer ?? true}
                size={220}
                title={molecule.name}
              />
            </div>
            {fact && (
              <p className="text-sm leading-relaxed text-muted-foreground">
                <RichText text={fact} />
              </p>
            )}
            {canBrowse && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/biomolekuly/${molecule.categorySlug}`}>
                  {homeStrings.moleculeOfDayOpen}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * The student home page — first item of every section's sidebar and where
 * the app opens: the tests open right now (across every section the
 * student can reach), their standing on the current section's boards, and
 * the molecule of the day.
 */
export function StudentHomePage() {
  const user = useAuthStore((s) => s.user)
  const { section } = useSection()
  const allowed = allowedSections(user?.sections ?? "calculations")

  const today = new Date().toLocaleDateString("cs-CZ", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {homeStrings.eyebrow} · {today}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {user?.username
            ? homeStrings.greeting.replace("{name}", user.username)
            : homeStrings.greetingAnonymous}
        </h1>
        <p className="text-sm text-muted-foreground">{cs.sections[section]}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <OpenTests allowed={allowed} />
          <Standings section={section} />
        </div>
        <MoleculeOfDay canBrowse={allowed.includes("biomolecules")} />
      </div>
    </div>
  )
}
