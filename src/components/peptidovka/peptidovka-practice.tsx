import { ArrowLeft, ArrowRight, Settings2 } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { type PeptideDraw, usePeptidovkaPool } from "@/hooks/use-peptidovka-pool"
import { cs } from "@/i18n/cs"
import type { PeptidovkaMode } from "@/lib/biomolecules-api"
import { isChainCorrect } from "@/lib/peptides"
import { normalizeChainInput } from "@/lib/peptides/answer"
import { cn } from "@/lib/utils"

const peptidovkaStrings = cs.peptidovka
const practiceStrings = cs.peptidovka.practice

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** Czech 1/2–4/5+ plural of "{n} aminokyselin*" for the round micro-label. */
function aminoAcidCountLabel(count: number): string {
  const forms = peptidovkaStrings.aminoAcidCount
  const form = count === 1 ? forms.one : count >= 2 && count <= 4 ? forms.few : forms.many
  return form.replace("{count}", String(count))
}

interface Verdict {
  typed: string
  correct: boolean
}

/**
 * Peptidovka as procvičování: an endless stream of peptides drawn from the
 * teacher's settings for the chosen mode (Učeň = coloured atoms, N-terminus
 * on the left; Mistr = one ink, random rotation). Unlike the Test-mode run
 * there is no clock and a mistake ends nothing — every answer is graded on
 * the spot, the student sees what they typed next to the correct chain, and
 * "Další peptid" (or Enter) serves the next one. Nothing is recorded.
 */
export function PeptidovkaPractice({ mode, onExit }: { mode: PeptidovkaMode; onExit: () => void }) {
  const master = mode === "mistr"
  const { status, draw } = usePeptidovkaPool(mode)

  const [peptide, setPeptide] = useState<PeptideDraw | null>(null)
  const [drawFailed, setDrawFailed] = useState(false)
  const [round, setRound] = useState(1)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [stats, setStats] = useState({ answered: 0, correct: 0 })
  const [value, setValue] = useState("")
  const gradingRef = useRef(false)

  const next = useCallback(() => {
    const drawn = draw()
    gradingRef.current = false
    setPeptide(drawn)
    setDrawFailed(drawn === null)
    setVerdict(null)
    setValue("")
    setRound((n) => n + 1)
  }, [draw])

  // First peptide as soon as the pool is ready.
  useEffect(() => {
    if (status === "ready" && peptide === null && !drawFailed) {
      const drawn = draw()
      setPeptide(drawn)
      setDrawFailed(drawn === null)
    }
  }, [status, peptide, drawFailed, draw])

  // Enter moves on once the verdict is showing — the input is disabled by
  // then, so this can never double as the grading keystroke.
  useEffect(() => {
    if (verdict === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return
      const target = event.target as HTMLElement | null
      if (target?.closest("button, a, input")) return
      event.preventDefault()
      next()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [verdict, next])

  const canSubmit = verdict === null && value.trim() !== ""

  const submit = () => {
    if (peptide === null || !canSubmit || gradingRef.current) return
    gradingRef.current = true
    const correct = isChainCorrect(value, peptide.expected)
    setVerdict({ typed: normalizeChainInput(value), correct })
    setStats((current) => ({
      answered: current.answered + 1,
      correct: current.correct + (correct ? 1 : 0),
    }))
  }

  const header = (
    <>
      <button
        type="button"
        onClick={onExit}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[4px] py-1 text-sm text-muted-foreground",
          "transition-colors duration-150 hover:text-foreground",
          FOCUS_RING_CLASS,
        )}
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {practiceStrings.backToSetup}
      </button>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {practiceStrings.title[mode]}
          </h1>
          <p className="text-sm text-muted-foreground">
            {master ? practiceStrings.descriptionMistr : practiceStrings.descriptionUcen}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {practiceStrings.statsLabel}
          </p>
          <p className="font-mono tabular text-lg font-semibold" aria-live="polite">
            {practiceStrings.stats
              .replace("{correct}", String(stats.correct))
              .replace("{answered}", String(stats.answered))}
          </p>
        </div>
      </div>
    </>
  )

  if (status === "loading" || (status === "ready" && peptide === null && !drawFailed)) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Skeleton className="h-8 w-48 rounded-[4px]" />
        <Skeleton className="h-64 rounded-[4px]" />
      </div>
    )
  }

  if (status !== "ready" || drawFailed || peptide === null) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {header}
        <Card>
          <CardContent className="space-y-2 py-10 text-center">
            <p className="font-medium">{peptidovkaStrings.emptyTitle}</p>
            <p className="text-sm text-muted-foreground">
              {status === "error"
                ? peptidovkaStrings.loadError
                : peptidovkaStrings.emptyDescription}
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      {header}

      <div className="space-y-2 py-2 text-center">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {peptidovkaStrings.roundLabel
            .replace("{index}", String(round))
            .replace("{count}", aminoAcidCountLabel(peptide.length))}
        </div>
        <div className="flex min-w-0 justify-center">
          <StructureView
            smiles={peptide.smiles}
            orientationDeg={peptide.orientationDeg}
            monochrome={master}
            size={240}
            grow
            maxWidth={640}
            title={peptidovkaStrings.structureLabel}
            className="max-w-full !h-auto [&>svg]:h-auto [&>svg]:max-w-full"
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-center gap-3">
          <Input
            key={round}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && verdict === null) {
                event.preventDefault()
                event.stopPropagation()
                submit()
              }
            }}
            placeholder={peptidovkaStrings.answerPlaceholder}
            aria-label={peptidovkaStrings.answerLabel}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            disabled={verdict !== null}
            className={cn(
              "max-w-xs text-center font-mono uppercase tracking-[0.2em]",
              verdict?.correct === true && "border-accent bg-accent/5 text-accent",
              verdict?.correct === false && "border-destructive bg-destructive/10 text-destructive",
              verdict !== null && "font-medium disabled:opacity-100",
            )}
          />
          {verdict === null && (
            <Button onClick={submit} disabled={!canSubmit}>
              {peptidovkaStrings.checkAnswer}
            </Button>
          )}
        </div>
        {verdict === null && (
          <p className="text-center text-xs text-muted-foreground">
            {peptidovkaStrings.answerHint}
          </p>
        )}
      </div>

      {verdict !== null && (
        <Card aria-live="polite">
          <CardContent className="space-y-4 pt-6">
            <p
              className={cn(
                "text-sm font-semibold",
                verdict.correct ? "text-accent" : "text-destructive",
              )}
            >
              {verdict.correct ? practiceStrings.verdictCorrect : practiceStrings.verdictIncorrect}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-[4px] border px-4 py-3 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {practiceStrings.yourAnswer}
                </p>
                <p
                  className={cn(
                    "break-all font-mono text-xl font-semibold tracking-[0.3em]",
                    verdict.correct ? "text-accent" : "text-destructive",
                  )}
                >
                  {verdict.typed}
                </p>
              </div>
              <div className="rounded-[4px] border bg-muted/50 px-4 py-3 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {peptidovkaStrings.correctAnswerLabel}
                </p>
                <p className="break-all font-mono text-xl font-semibold tracking-[0.3em]">
                  {peptide.expected}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={next} autoFocus>
                {practiceStrings.next}
                <ArrowRight className="size-4" />
              </Button>
              <Button variant="outline" onClick={onExit}>
                <Settings2 className="size-4" />
                {practiceStrings.backToSetup}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
