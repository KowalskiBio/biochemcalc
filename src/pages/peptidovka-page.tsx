import { ArrowLeft, Crown, RotateCcw, Swords, Timer, Trophy } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { useCountdown } from "@/hooks/use-countdown"
import { cs } from "@/i18n/cs"
import {
  biomoleculesApi,
  type PeptidovkaMode,
  type PeptidovkaSettings,
} from "@/lib/biomolecules-api"
import { AMINO_ACIDS_SLUG, TRAIT, traitOf } from "@/lib/molecules"
import { ensureRdkit } from "@/lib/molecules/render/rdkit-engine"
import {
  expectedChainLetters,
  generatePeptide,
  isChainCorrect,
  nLeftOrientationDeg,
  peptideParts,
} from "@/lib/peptides"
import { cn } from "@/lib/utils"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useMoleculeCategories,
} from "@/stores/biomolecule-data-store"

const peptidovkaStrings = cs.peptidovka

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

function formatMinutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/** Czech 1/2–4/5+ plural of "{n} aminokyselin*" for the round micro-label. */
function aminoAcidCountLabel(count: number): string {
  const forms = peptidovkaStrings.aminoAcidCount
  const form = count === 1 ? forms.one : count >= 2 && count <= 4 ? forms.few : forms.many
  return form.replace("{count}", String(count))
}

/**
 * Učeň's canonical reading direction — structure laid N-terminus left. Any
 * geometry hiccup (unparseable SMILES, RDKit still initializing) degrades
 * to the unrotated draw rather than killing the round.
 */
function nLeftDeg(smiles: string, nIndex: number): number {
  try {
    return nLeftOrientationDeg(smiles, nIndex) ?? 0
  } catch {
    return 0
  }
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      to={href}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[4px] py-1 text-sm text-muted-foreground",
        "transition-colors duration-150 hover:text-foreground",
        FOCUS_RING_CLASS,
      )}
    >
      <ArrowLeft className="size-4" strokeWidth={1.75} />
      {label}
    </Link>
  )
}

function MicroLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/** One served peptide, with everything the round needs precomputed. */
interface Round {
  slugs: string[]
  smiles: string
  orientationDeg: number
  /** The N→C one-letter answer, already uppercased. */
  expected: string
  length: number
  timeLimitSeconds: number
  deadlineMs: number
}

interface Run {
  startedAt: number
  /** Frozen at the moment of the mistake/timeout — the results readout's end. */
  endedAt: number | null
  /** One point per amino acid of every correctly read peptide. */
  points: number
  /** Correctly read peptides in a row. */
  solvedCount: number
  phase: "active" | "failed"
  failedBy: "wrong" | "timeout" | null
  /** Countdown value frozen at the failure, so the timer readout can stop dead. */
  frozenRemainingSeconds: number | null
}

interface ChainAnswerFormProps {
  answered: boolean
  verdict: "incorrect" | null
  onSubmit: (value: string) => void
}

/**
 * The one-letter answer slot. Mirrors the streak's open-answer form,
 * including the Enter ownership (`stopPropagation`, so the page-level
 * "Enter restarts after failure" listener can never double as grading) and
 * the remount-per-round draft (`key`). Mono + uppercase: the answer
 * alphabet IS one-letter codes, and the grader is case-insensitive anyway.
 */
function ChainAnswerForm({ answered, verdict, onSubmit }: ChainAnswerFormProps) {
  const [value, setValue] = useState("")
  const canSubmit = !answered && value.trim() !== ""

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-center gap-3">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !answered) {
              event.preventDefault()
              event.stopPropagation()
              if (canSubmit) onSubmit(value)
            }
          }}
          placeholder={peptidovkaStrings.answerPlaceholder}
          aria-label={peptidovkaStrings.answerLabel}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={answered}
          className={cn(
            "max-w-xs text-center font-mono uppercase tracking-[0.2em]",
            verdict === "incorrect" && "border-destructive bg-destructive/10 text-destructive",
            // A locked-in answer should read as graded, not greyed out.
            verdict !== null && "font-medium disabled:opacity-100",
          )}
        />
        {!answered && (
          <Button onClick={() => onSubmit(value)} disabled={!canSubmit}>
            {peptidovkaStrings.checkAnswer}
          </Button>
        )}
      </div>
      {!answered && (
        <p className="text-center text-xs text-muted-foreground">{peptidovkaStrings.answerHint}</p>
      )}
    </div>
  )
}

const MODES = [
  {
    mode: "ucen",
    to: "/biomolekuly/peptidovka/ucen",
    icon: Swords,
    title: cs.test.modeUcenTitle,
    description: peptidovkaStrings.modeUcenDescription,
  },
  {
    mode: "mistr",
    to: "/biomolekuly/peptidovka/mistr",
    icon: Crown,
    title: cs.test.modeMistrTitle,
    description: peptidovkaStrings.modeMistrDescription,
  },
] as const

/**
 * Peptidovka's entry point — the same two-card mode pick as the Biomolekuly
 * test hub (shared `cs.test` mode titles, Peptidovka-specific descriptions).
 */
export function PeptidovkaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {peptidovkaStrings.title}
        </h1>
        <p className="text-muted-foreground text-sm">{peptidovkaStrings.modePickDescription}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MODES.map(({ mode, to, icon: Icon, title, description }) => (
          <Link key={mode} to={to} className="block h-full">
            <Card className="h-full cursor-pointer transition-colors hover:border-primary hover:bg-primary/5">
              <CardHeader>
                <Icon className="size-6 text-primary" strokeWidth={1.75} />
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * The Peptidovka run: one generated peptide structure per round, answered as
 * one-letter codes N→C. Like the biomolecules streak, the whole run lives in
 * this component — the quiz material is local and settings are fetched once
 * per page mount — and only the final {points, totalSeconds} pair is posted,
 * best effort, the moment the run fails. A reload loses the in-progress run,
 * same limitation the other streaks have.
 */
export function PeptidovkaRunPage({ mode }: { mode: PeptidovkaMode }) {
  const master = mode === "mistr"
  const loaded = useBiomoleculeDataLoaded()
  const categories = useMoleculeCategories()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  const [settingsAll, setSettingsAll] = useState<PeptidovkaSettings[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  // Settings come once per page mount — a teacher's mid-run edits are a
  // non-case, exactly like the streak's pool built from the loaded dataset.
  useEffect(() => {
    let cancelled = false
    biomoleculesApi
      .peptidovkaSettings()
      .then((rows) => {
        if (!cancelled) setSettingsAll(rows)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // RDKit has to be up before Učeň's N-left orientation can be measured; the
  // wasm usually wins the race against the dataset, and fail-open degrades
  // to the unrotated draw (nLeftDeg) instead of never starting.
  const [rdkitReady, setRdkitReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    ensureRdkit()
      .catch(() => {})
      .then(() => {
        if (!cancelled) setRdkitReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const modeSettings = useMemo(
    () => settingsAll?.find((row) => row.mode === mode) ?? null,
    [settingsAll, mode],
  )

  // The playable pool: the amino-acid category's molecules that carry a
  // one-letter code (the answer alphabet) — the same dataset the streak
  // draws its categories from — intersected with the mode's settings slugs.
  const playableBySlug = useMemo(() => {
    const map = new Map<string, string>()
    for (const molecule of allMolecules) {
      if (molecule.categorySlug !== AMINO_ACIDS_SLUG) continue
      const oneLetter = traitOf(molecule, TRAIT.oneLetter)
      if (oneLetter !== undefined) map.set(molecule.slug, oneLetter)
    }
    return map
  }, [allMolecules])

  const pool = useMemo(() => {
    if (modeSettings === null) return []
    const seen = new Set<string>()
    const slugs: string[] = []
    for (const slug of modeSettings.slugs) {
      if (!playableBySlug.has(slug) || seen.has(slug)) continue
      seen.add(slug)
      slugs.push(slug)
    }
    return slugs
  }, [modeSettings, playableBySlug])

  const [run, setRun] = useState<Run | null>(null)
  const [round, setRound] = useState<Round | null>(null)
  const [roundIndex, setRoundIndex] = useState(1)
  // Bumped at every startRun — the answer form keys on it together with the
  // round index, so a restart after a round-ONE failure also remounts the
  // input (key changes 1→2 even though the round index restarts at 1).
  const [runId, setRunId] = useState(0)
  // Set when synthesis proves impossible even after the one redraw (a pool
  // slug with no residue template) — the run can never serve a round.
  const [roundImpossible, setRoundImpossible] = useState(false)
  // Synchronous double-end guard: an Enter submit plus a timer tick inside
  // one React batch would both end the run.
  const endingRef = useRef(false)

  // Serve the next peptide. Unknown slugs in the pool (no residue template —
  // a teacher-added acid the synthesizer doesn't know) get exactly one
  // redraw with a fresh seed, then the round is declared impossible;
  // length falls back to a sane span should the server's bounds ever slip.
  const nextRound = useCallback(
    (startedAtMs: number): Round | null => {
      if (modeSettings === null || pool.length === 0) return null
      const maxLen = Math.max(modeSettings.minLen, modeSettings.maxLen)
      const minLen = Math.max(1, Math.min(modeSettings.minLen, maxLen))
      for (let attempt = 0; attempt < 2; attempt++) {
        const random = crypto.getRandomValues(new Uint32Array(3))
        const length = minLen + (random[0] % (maxLen - minLen + 1))
        const slugs = generatePeptide(pool, length, random[1])
        const parts = peptideParts(slugs)
        if (parts === null) continue
        const letters = slugs.map((slug) => playableBySlug.get(slug))
        if (letters.some((letter) => letter === undefined)) continue
        // Mistr rotates the chain to a pseudo-random angle per round; Učeň
        // keeps the canonical N-terminus-left reading direction.
        const orientationDeg = master ? random[2] % 360 : nLeftDeg(parts.smiles, parts.nIndex)
        const timeLimitSeconds = modeSettings.secondsPerAa * length
        return {
          slugs,
          smiles: parts.smiles,
          orientationDeg,
          expected: expectedChainLetters(letters as string[]),
          length,
          timeLimitSeconds,
          deadlineMs: startedAtMs + timeLimitSeconds * 1000,
        }
      }
      return null
    },
    [modeSettings, pool, playableBySlug, master],
  )

  const startRun = useCallback(() => {
    const nowMs = Date.now()
    endingRef.current = false
    setRunId((id) => id + 1)
    const first = nextRound(nowMs)
    setRoundIndex(1)
    setRound(first)
    setRoundImpossible(first === null)
    setRun({
      startedAt: nowMs,
      endedAt: null,
      points: 0,
      solvedCount: 0,
      phase: "active",
      failedBy: null,
      frozenRemainingSeconds: null,
    })
  }, [nextRound])

  // Kick off the first run as soon as everything it draws from is there —
  // after it `run` is set, so this fires exactly once per page entry
  // (restart is startRun called from the UI).
  useEffect(() => {
    if (loaded && settingsAll !== null && pool.length >= 2 && rdkitReady && run === null) {
      startRun()
    }
  }, [loaded, settingsAll, pool.length, rdkitReady, run, startRun])

  const endRun = useCallback(
    (by: "wrong" | "timeout", remaining: number | null) => {
      const current = run
      if (current?.phase !== "active" || endingRef.current) return
      endingRef.current = true
      const endedAt = Date.now()
      const totalSeconds = Math.max(0, Math.round((endedAt - current.startedAt) / 1000))
      // Best effort: a lost score only costs a leaderboard entry, not the
      // end screen the student is looking at. The board's "best run" means
      // the number of SOLVED peptides — points stay decorative in-game.
      biomoleculesApi
        .recordPeptidovkaRun({ mode, correctCount: current.solvedCount, totalSeconds })
        .catch(() => {})
      setRun({
        ...current,
        endedAt,
        phase: "failed",
        failedBy: by,
        frozenRemainingSeconds: remaining,
      })
    },
    [run, mode],
  )

  const active = run?.phase === "active"
  // The countdown only ticks while the round is live — on failure it is cut
  // (undefined deadline) and the display switches to the frozen value.
  const { remainingSeconds, expired } = useCountdown(
    active && round !== null ? round.deadlineMs : undefined,
  )

  // Timer expiry ends the run with zero points for the interrupted round.
  useEffect(() => {
    if (active && expired) endRun("timeout", remainingSeconds)
  }, [active, expired, remainingSeconds, endRun])

  // Enter restarts once the run has failed — unless the keystroke belongs
  // to a focused button/link, which has its own Enter semantics.
  useEffect(() => {
    if (run?.phase !== "failed") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return
      const target = event.target as HTMLElement | null
      if (target?.closest("button, a, input")) return
      event.preventDefault()
      startRun()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [run?.phase, startRun])

  const submitAnswer = (input: string) => {
    const current = run
    if (round === null || current?.phase !== "active" || endingRef.current) return
    if (!isChainCorrect(input, round.expected)) {
      endRun("wrong", remainingSeconds)
      return
    }
    // Correct: +1 point per amino acid of this peptide, next round straight
    // away — deliberately no per-round celebration, like the streak.
    const points = current.points + round.length
    const solvedCount = current.solvedCount + 1
    const next = nextRound(Date.now())
    if (next === null) {
      // The pool can still hold a slug with no residue template (a teacher's
      // custom amino acid). Never strand an active run: the session ends
      // HERE inside the results card — not in the launch-failure empty
      // state, which would hide the results and read "wait for the teacher"
      // mid-game. Earned points still show; the recorded run's solved count
      // is what just reached history.
      endingRef.current = true
      const endedAt = Date.now()
      const totalSeconds = Math.max(0, Math.round((endedAt - current.startedAt) / 1000))
      biomoleculesApi
        .recordPeptidovkaRun({ mode, correctCount: solvedCount, totalSeconds })
        .catch(() => {})
      setRun({
        ...current,
        points,
        solvedCount,
        endedAt,
        phase: "failed",
        failedBy: null,
        frozenRemainingSeconds: remainingSeconds,
      })
      return
    }
    setRun({ ...current, points, solvedCount })
    setRoundIndex((n) => n + 1)
    setRound(next)
  }

  if (!loaded || (settingsAll === null && !loadFailed)) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48 rounded-[4px]" />
        <Skeleton className="h-24 rounded-[4px]" />
        <Skeleton className="h-64 rounded-[4px]" />
      </div>
    )
  }

  if (loadFailed) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <BackLink href="/biomolekuly/peptidovka" label={peptidovkaStrings.backToModes} />
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="font-medium">{peptidovkaStrings.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{peptidovkaStrings.loadError}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  // The dataset is missing the amino-acid category, no one-letter-coded
  // molecules, or the mode's pool is below two acids — a friendly state
  // instead of a run that can never serve a round.
  if (
    roundImpossible ||
    !categories.some((category) => category.slug === AMINO_ACIDS_SLUG) ||
    playableBySlug.size === 0 ||
    pool.length < 2
  ) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <BackLink href="/biomolekuly/peptidovka" label={peptidovkaStrings.backToModes} />
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="font-medium">{peptidovkaStrings.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">{peptidovkaStrings.emptyDescription}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!run || !round) {
    // The dataset is loaded and the start effect is about to fire — a single
    // frame at most; render nothing rather than flicker a skeleton again.
    return null
  }

  const failed = run.phase === "failed"
  const displayRemaining = failed ? run.frozenRemainingSeconds : remainingSeconds
  const remainingFraction =
    displayRemaining !== null && round.timeLimitSeconds > 0
      ? Math.min(1, displayRemaining / round.timeLimitSeconds)
      : 0
  const lowTime = !failed && displayRemaining !== null && displayRemaining <= 5
  const elapsedSeconds = Math.max(
    0,
    Math.floor(((run.endedAt ?? Date.now()) - run.startedAt) / 1000),
  )

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <BackLink href="/biomolekuly/peptidovka" label={peptidovkaStrings.backToModes} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {peptidovkaStrings.runTitle[mode]}
          </h1>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {peptidovkaStrings.pointsSoFar.replace("{points}", String(run.points))}
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground flex items-center gap-1 justify-end">
            <Timer className="size-3" />
            {cs.test.timeRemaining}
          </p>
          <p className={cn("text-lg font-semibold tabular-nums", lowTime && "text-destructive")}>
            {formatMinutesSeconds(displayRemaining ?? 0)}
          </p>
        </div>
      </div>

      {/* The round clock as one hairline bar — the same instrument readout
          at a glance, red under the last five seconds, frozen at failure. */}
      <Progress
        value={100 * remainingFraction}
        aria-label={cs.test.timeRemaining}
        className={cn("h-1.5", lowTime && "bg-destructive/20 [&>div]:bg-destructive")}
      />

      <div className="space-y-2 py-2 text-center">
        <MicroLabel>
          {peptidovkaStrings.roundLabel
            .replace("{index}", String(roundIndex))
            .replace("{count}", aminoAcidCountLabel(round.length))}
        </MicroLabel>
        <div className="flex min-w-0 justify-center">
          {/* The peptide is the sample on the bench: `grow` keeps the chain
              at 1:1 bonds up to the run column's width (max-w-2xl = 672 px,
              minus a margin = the explicit cap), and the svg scales down
              with its wrapper on screens narrower than the grown draw —
              same discipline as the molecule detail dialog. Mistr hides the
              atom colour coding, so the palette can't give residues away. */}
          <StructureView
            smiles={round.smiles}
            orientationDeg={round.orientationDeg}
            monochrome={master}
            size={240}
            grow
            maxWidth={640}
            title={peptidovkaStrings.structureLabel}
            className="max-w-full !h-auto [&>svg]:h-auto [&>svg]:max-w-full"
          />
        </div>
      </div>

      <ChainAnswerForm
        key={`${runId}-${roundIndex}`}
        answered={failed}
        verdict={failed && run.failedBy === "wrong" ? "incorrect" : null}
        onSubmit={submitAnswer}
      />

      {failed && (
        <Card aria-live="polite">
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
              <Trophy className="size-8 text-amber-500" />
              <div className="space-y-0.5">
                <p
                  className={
                    run.failedBy === null
                      ? "text-sm font-medium text-foreground"
                      : "text-sm font-medium text-destructive"
                  }
                >
                  {run.failedBy === "timeout"
                    ? peptidovkaStrings.failedTimeout
                    : run.failedBy === "wrong"
                      ? peptidovkaStrings.failedWrong
                      : peptidovkaStrings.failedInterrupted}
                </p>
                <p className="text-sm text-muted-foreground">
                  {peptidovkaStrings.pointsSoFar.replace("{points}", String(run.points))}
                </p>
              </div>
            </div>

            {run.failedBy !== null && (
              <div className="rounded-[4px] border bg-muted/50 px-4 py-3 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {peptidovkaStrings.correctAnswerLabel}
                </p>
                <p className="break-all font-mono text-2xl font-semibold tracking-[0.3em]">
                  {round.expected}
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-4 border-t pt-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {peptidovkaStrings.resultsPoints}
                </p>
                <p className="text-lg font-semibold tabular-nums">{run.points}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {peptidovkaStrings.resultsPeptides}
                </p>
                <p className="text-lg font-semibold tabular-nums">{run.solvedCount}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {peptidovkaStrings.resultsTime}
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatMinutesSeconds(elapsedSeconds)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={startRun}>
                <RotateCcw className="size-4 mr-2" />
                {peptidovkaStrings.playAgain}
              </Button>
              <Button variant="outline" asChild>
                <Link to="/biomolekuly/peptidovka">{peptidovkaStrings.backToModes}</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
