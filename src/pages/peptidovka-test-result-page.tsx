import { ArrowLeft } from "lucide-react"
import { Link, useLocation } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import type { PeptidovkaTestStudentView } from "@/lib/biomolecules-api"
import { nLeftOrientationDeg } from "@/lib/peptides"
import { generatePeptidovkaTestRun, type PeptidovkaTestRun } from "@/lib/peptides/test"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const testyStrings = cs.peptidovka.testy
const peptidovkaStrings = cs.peptidovka

/** Review payload handed over by the run page (fresh submissions only). */
interface RunReview {
  chains: string[]
  structures: { smiles: string; nIndex: number }[]
  typed: (string | null)[]
  verdicts: boolean[]
}

function nLeftDeg(smiles: string, nIndex: number): number {
  try {
    return nLeftOrientationDeg(smiles, nIndex) ?? 0
  } catch {
    return 0
  }
}

export function PeptidovkaTestResultPage() {
  const location = useLocation()
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  const state = location.state as {
    view?: PeptidovkaTestStudentView
    review?: RunReview
  } | null
  const view = state?.view ?? null
  const review = state?.review ?? null

  const test = view?.test ?? null
  const attempt = view?.attempt ?? null

  // Post-hub review: regenerate the peptides from the attempt seed. The
  // student's typed answers were never stored server-side, so that review
  // shows the correct chains only.
  let regenerated: PeptidovkaTestRun | null = null
  if (loaded && test !== null && review === null && attempt !== null) {
    regenerated = generatePeptidovkaTestRun(test, attempt.seed, allMolecules)
  }

  if (!loaded || view === null || test === null || attempt === null) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <p className="text-sm text-destructive">{testyStrings.loadError}</p>
        <Button variant="outline" asChild>
          <Link to="/biomolekuly/peptidovka">{testyStrings.backToHub}</Link>
        </Button>
      </div>
    )
  }

  const total = attempt.totalCount ?? test.peptideCount
  const correct = attempt.correctCount ?? 0
  const percentage = total === 0 ? 0 : Math.round((correct / total) * 100)

  // Review rows: fresh submissions carry typed answers + verdicts; older
  // ones show the regenerated chains only.
  const reviewRows: {
    id: string
    chain: string
    structure: { smiles: string; nIndex: number }
    typed: string | null
    verdict: boolean | undefined
  }[] =
    review !== null
      ? review.chains.map((chain, index) => ({
          id: `${attempt.attemptId}-${index}`,
          chain,
          structure: review.structures[index] ?? { smiles: "", nIndex: 0 },
          typed: review.typed[index] ?? null,
          verdict: review.verdicts[index],
        }))
      : regenerated !== null
        ? regenerated.chains.map((chain, index) => ({
            id: `${attempt.attemptId}-${index}`,
            chain,
            structure: regenerated.structures[index] ?? { smiles: "", nIndex: 0 },
            typed: null,
            verdict: undefined,
          }))
        : []

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div>
        <Link
          to="/biomolekuly/peptidovka"
          className="inline-flex items-center gap-1.5 rounded-[4px] py-1 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          {testyStrings.backToHub}
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{testyStrings.resultTitle}</h1>
        <p className="text-sm text-muted-foreground">{test.title}</p>
      </div>

      <div className="py-2 text-center">
        <div className="font-mono tabular text-4xl font-semibold tracking-tight">
          {testyStrings.scoreLine
            .replace("{correct}", String(correct))
            .replace("{total}", String(total))}
        </div>
        <p className="mt-1 font-mono tabular text-sm text-muted-foreground">{percentage} %</p>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">{testyStrings.reviewTitle}</h2>
        {reviewRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {testyStrings.resultGenerationUnavailable}
          </p>
        ) : (
          <>
            {review === null && (
              <p className="text-sm text-muted-foreground">{testyStrings.typedReviewMissing}</p>
            )}
            <ol className="space-y-4">
              {reviewRows.map((row) => (
                <li key={row.id} className="rounded-[4px] border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {testyStrings.peptideNumber.replace(
                        "{number}",
                        String(reviewRows.indexOf(row) + 1),
                      )}
                    </p>
                    {row.verdict !== undefined && (
                      <span
                        className={
                          row.verdict
                            ? "font-mono tabular text-xs font-semibold text-accent"
                            : "font-mono tabular text-xs font-semibold text-destructive"
                        }
                      >
                        {row.verdict ? quizCorrect : quizIncorrect}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex min-w-0 justify-center">
                    <StructureView
                      smiles={row.structure.smiles}
                      orientationDeg={nLeftDeg(row.structure.smiles, row.structure.nIndex)}
                      monochrome={test.monochrome}
                      size={200}
                      title={peptidovkaStrings.structureLabel}
                      className="max-w-full"
                    />
                  </div>
                  <div className="mt-3 rounded-[4px] border bg-muted/50 px-4 py-2 text-center">
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {peptidovkaStrings.correctAnswerLabel}
                    </p>
                    <p className="break-all font-mono text-xl font-semibold tracking-[0.3em]">
                      {row.chain}
                    </p>
                  </div>
                  {row.typed !== null && (
                    <p className="mt-2 text-center text-sm">
                      <span className="text-muted-foreground">
                        {peptidovkaStrings.answerLabel}:{" "}
                      </span>
                      <span
                        className={
                          row.verdict
                            ? "font-mono font-semibold text-accent"
                            : "font-mono font-semibold text-destructive"
                        }
                      >
                        {row.typed}
                      </span>
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  )
}

const quizCorrect = cs.biomolekuly.quiz.correct
const quizIncorrect = cs.biomolekuly.quiz.incorrect
