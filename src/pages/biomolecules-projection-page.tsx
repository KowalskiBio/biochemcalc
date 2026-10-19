import { useEffect, useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { previewRecognition, type RecognitionVerdict } from "@/lib/molecules/render/preview"
import { cn } from "@/lib/utils"

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** Same small-caps label the quiz/streak pages use above their picker groups. */
function MicroLabel({ children }: { children: string }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * Curated teacher examples. Names/reasons are Czech teaching content, so they
 * live inline (like built-in molecule datasets); section/group headings are
 * UI chrome and come from cs.biomolekuly.projection.
 */
interface ProjectionExample {
  name: string
  smiles: string
  /** Muted one-liner — only the skeletal (unrecognized) group carries one. */
  reason?: string
}

const RECOGNIZED_EXAMPLES: ProjectionExample[] = [
  { name: "α-D-glukóza", smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O)O)O)O)O" },
  { name: "β-D-fruktóza", smiles: "OC[C@]1(O)[C@@H](O)[C@@H](O)[C@@H](CO)O1" },
  {
    name: "adenosin (nukleotid, ribofuranóza)",
    smiles: "NC1=NC=NC2=C1N=CN2[C@@H]3O[C@H](CO)[C@@H](O)[C@H]3O",
  },
  {
    name: "sacharosa (disacharid, glykos. můstek)",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O",
  },
]

const SKELETAL_EXAMPLES: ProjectionExample[] = [
  {
    name: "glukóza bez stereochemie",
    smiles: "OCC1OC(O)C(O)C(O)C1O",
    reason: "chybí stereo značky (@/@@)",
  },
  {
    name: "tetrahydrofuran",
    smiles: "C1CCOC1",
    reason: "cyklus bez anomerního uhlíku — není cukr",
  },
  { name: "benzen", smiles: "c1ccccc1", reason: "aromatický cyklus" },
  {
    name: "maltóza (bez stereo na C5 druhého cyklu)",
    smiles: "C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@@H]2[C@H](OC([C@@H]([C@H]2O)O)O)CO)O)O)O)O",
    reason: "jeden cyklus rozpoznán, druhý nemá stereo → skeletová část",
  },
]

/** One clickable example: name (+ optional muted reason) and a truncated SMILES. */
function ProjectionExampleRow({
  example,
  onSelect,
}: {
  example: ProjectionExample
  onSelect: (smiles: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(example.smiles)}
      className={cn(
        "flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-[4px] border bg-card px-3 py-2 text-left",
        "transition-colors duration-150 hover:border-primary/50",
        "sm:flex-row sm:items-baseline sm:gap-3",
        FOCUS_RING_CLASS,
      )}
    >
      <span className="shrink-0 text-sm font-medium text-foreground">{example.name}</span>
      {example.reason !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground">{example.reason}</span>
      )}
      <span
        className="w-full min-w-0 truncate font-mono text-xs text-muted-foreground sm:w-auto sm:flex-1"
        title={example.smiles}
      >
        {example.smiles}
      </span>
    </button>
  )
}

/**
 * Teacher tooling: paste a SMILES string and immediately see whether the
 * jersey-recognizer treats any of its rings as a sugar and draws it as a
 * Haworth projection. Mirrors how Vzorce/Konstanty previews work for the
 * calculations section. Below the live preview, a short explanation of the
 * recognition rules plus clickable examples that load into the same input.
 */
export function BiomoleculesProjectionPage() {
  const [smiles, setSmiles] = useState("")
  const [drawingValid, setDrawingValid] = useState(false)
  const [verdict, setVerdict] = useState<RecognitionVerdict | null>(null)

  const trimmed = smiles.trim()
  useEffect(() => {
    if (trimmed === "") {
      setVerdict(null)
      return
    }
    let cancelled = false
    previewRecognition(trimmed).then((next) => {
      if (!cancelled) {
        setVerdict(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [trimmed])

  const ringText =
    verdict?.status === "recognized"
      ? verdict.forms
          .map((form) =>
            form === "pyranose"
              ? cs.biomolekuly.projection.ringPyranose
              : cs.biomolekuly.projection.ringFuranose,
          )
          .join(", ")
      : null

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.biomolekuly.projection.title}
        </h1>
        <p className="text-sm text-muted-foreground">{cs.biomolekuly.projection.description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{cs.biomolekuly.projection.cardTitle}</CardTitle>
          <CardDescription>{cs.biomolekuly.projection.cardDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2 sm:max-w-xl">
            <Label htmlFor="projection-smiles">{cs.biomolekuly.projection.smilesLabel}</Label>
            <Input
              id="projection-smiles"
              value={smiles}
              onChange={(event) => setSmiles(event.target.value)}
              placeholder={cs.biomolekuly.projection.smilesPlaceholder}
              spellCheck={false}
              autoComplete="off"
              className="font-mono"
            />
          </div>

          {trimmed !== "" && (
            <div className="flex flex-wrap items-start gap-6">
              <div className="space-y-2">
                {/* Single-molecule preview: `grow` keeps 1:1 bonds. The
                    wrapping flex item is shrink-to-fit, so its width would
                    feed back on the grown depiction — cap with maxWidth. */}
                <StructureView
                  smiles={trimmed}
                  size={320}
                  grow
                  maxWidth={640}
                  onValidityChange={setDrawingValid}
                />
              </div>
              <div className="space-y-1 pt-2 text-sm">
                {verdict === null ? null : verdict.status === "invalid" ? (
                  <p className="text-destructive">{cs.biomolekuly.projection.verdictInvalid}</p>
                ) : verdict.status === "recognized" && ringText !== null ? (
                  drawingValid ? (
                    <p>
                      <span className="font-medium text-accent">
                        {cs.biomolekuly.projection.verdictRecognized}
                      </span>{" "}
                      {ringText}
                    </p>
                  ) : null
                ) : drawingValid ? (
                  <p className="text-muted-foreground">{cs.biomolekuly.projection.verdictNone}</p>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{cs.biomolekuly.projection.howItWorksTitle}</CardTitle>
        </CardHeader>
        <CardContent className="max-w-3xl space-y-3 text-sm text-muted-foreground">
          <p>{cs.biomolekuly.projection.howItWorksP1}</p>
          <p>{cs.biomolekuly.projection.howItWorksP2}</p>
          <p>{cs.biomolekuly.projection.howItWorksP3}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{cs.biomolekuly.projection.examplesTitle}</CardTitle>
          <CardDescription>{cs.biomolekuly.projection.examplesDescription}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <MicroLabel>{cs.biomolekuly.projection.examplesRecognizedTitle}</MicroLabel>
            <div className="space-y-1.5">
              {RECOGNIZED_EXAMPLES.map((example) => (
                <ProjectionExampleRow key={example.smiles} example={example} onSelect={setSmiles} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <MicroLabel>{cs.biomolekuly.projection.examplesSkeletalTitle}</MicroLabel>
            <div className="space-y-1.5">
              {SKELETAL_EXAMPLES.map((example) => (
                <ProjectionExampleRow key={example.smiles} example={example} onSelect={setSmiles} />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
