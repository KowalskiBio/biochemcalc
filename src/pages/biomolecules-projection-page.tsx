import { useMemo, useState } from "react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { previewRecognition } from "@/lib/molecules/render/preview"

/**
 * Teacher tooling: paste a SMILES string and immediately see whether the
 * jersey-recognizer treats any of its rings as a sugar and draws it as a
 * Haworth projection. Mirrors how Vzorce/Konstanty previews work for the
 * calculations section.
 */
export function BiomoleculesProjectionPage() {
  const [smiles, setSmiles] = useState("")
  const [drawingValid, setDrawingValid] = useState(false)

  const trimmed = smiles.trim()
  const verdict = useMemo(
    () => (trimmed === "" ? null : previewRecognition(trimmed)),
    [trimmed],
  )

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
                <StructureView
                  smiles={trimmed}
                  size={320}
                  onValidityChange={setDrawingValid}
                />
              </div>
              <div className="space-y-1 pt-2 text-sm">
                {verdict?.status === "invalid" || !drawingValid ? (
                  <p className="text-destructive">{cs.biomolekuly.projection.verdictInvalid}</p>
                ) : verdict?.status === "recognized" && ringText !== null ? (
                  <p>
                    <span className="font-medium text-accent">
                      {cs.biomolekuly.projection.verdictRecognized}
                    </span>{" "}
                    {ringText}
                  </p>
                ) : (
                  <p className="text-muted-foreground">
                    {cs.biomolekuly.projection.verdictNone}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
