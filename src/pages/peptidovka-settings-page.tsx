import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RichText } from "@/components/ui/rich-text"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import {
  type Biomolecule,
  biomoleculesApi,
  type PeptidovkaMode,
  type PeptidovkaSettings,
} from "@/lib/biomolecules-api"
import { extractErrorMessage } from "@/lib/http"
import { PEPTIDE_FAMILY_SLUGS, TRAIT, traitOf } from "@/lib/molecules"
import { cn } from "@/lib/utils"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const peptidovkaStrings = cs.peptidovka

/** Server bounds, mirrored client-side. The server stays the authority. */
const LENGTH_MIN = 2
const LENGTH_MAX = 20
const SECONDS_MIN = 3
const SECONDS_MAX = 120
/** Weight input range. 1 = default odds, 0.5 = half as likely, 0 = off. */
const WEIGHT_MIN = 0
const WEIGHT_MAX = 1
const DEFAULT_WEIGHT = 1

/** Czech two-decimal readout of a weight: "1,00", "0,50", "0,25", "0". */
function formatWeight(weight: number): string {
  return weight === 0 ? "0" : weight.toFixed(2).replace(".", ",")
}

/** Decimal parse accepting either Czech comma or dot; blank/garbage is invalid. */
function parseWeight(text: string): number | undefined {
  const trimmed = text.trim()
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) {
    return undefined
  }
  const weight = Number(trimmed.replace(",", "."))
  return Number.isFinite(weight) ? weight : undefined
}

function isWeightValid(weight: number | undefined): weight is number {
  return (
    weight !== undefined && Number.isFinite(weight) && weight >= WEIGHT_MIN && weight <= WEIGHT_MAX
  )
}

interface ModeCardCopy {
  title: string
  description: string
}

function modeCopy(mode: PeptidovkaMode): ModeCardCopy {
  return mode === "ucen"
    ? { title: cs.test.modeUcenTitle, description: peptidovkaStrings.modeUcenDescription }
    : { title: cs.test.modeMistrTitle, description: peptidovkaStrings.modeMistrDescription }
}

/** Whole-number parse of a draft input; undefined for anything else. */
function parseBound(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) return undefined
  return Number(text.trim())
}

interface ModeSectionProps {
  settings: PeptidovkaSettings
  /** The selectable amino acids — category molecules with a one-letter code. */
  pool: Biomolecule[]
}

/**
 * One mode's settings card: length bounds, the per-acid time budget, and
 * the amino-acid pool, with a single save action. Drafts live as strings so
 * a half-typed number doesn't fight the input; the inline message mirrors
 * the server's bounds and keeps Save disabled while the draft can't land.
 */
function PeptidovkaModeSection({ settings, pool }: ModeSectionProps) {
  const { toast } = useToast()
  const copy = modeCopy(settings.mode)

  const [minLenText, setMinLenText] = useState(String(settings.minLen))
  const [maxLenText, setMaxLenText] = useState(String(settings.maxLen))
  const [secondsText, setSecondsText] = useState(String(settings.secondsPerAa))
  // Text drafts keep blank and half-typed values visible. A pool molecule
  // missing from the saved map starts at the default weight; only an
  // explicit zero switches it off. Stale slugs are not carried into the draft.
  const [weightTexts, setWeightTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      pool.map((molecule) => [
        molecule.slug,
        formatWeight(settings.weights[molecule.slug] ?? DEFAULT_WEIGHT),
      ]),
    ),
  )
  const [saving, setSaving] = useState(false)

  const minLen = parseBound(minLenText)
  const maxLen = parseBound(maxLenText)
  const seconds = parseBound(secondsText)
  const parsedWeights = new Map(
    pool.map((molecule) => [
      molecule.slug,
      parseWeight(weightTexts[molecule.slug] ?? formatWeight(DEFAULT_WEIGHT)),
    ]),
  )

  const lengthValid =
    minLen !== undefined &&
    maxLen !== undefined &&
    minLen >= LENGTH_MIN &&
    maxLen <= LENGTH_MAX &&
    maxLen >= minLen
  const secondsValid = seconds !== undefined && seconds >= SECONDS_MIN && seconds <= SECONDS_MAX
  const weightsValid = pool.every((molecule) => isWeightValid(parsedWeights.get(molecule.slug)))
  // Count only valid positive weights that are still selectable (a molecule
  // may have been deleted or stripped of oneLetter since the settings save).
  const activeInPool = pool.filter((molecule) => {
    const weight = parsedWeights.get(molecule.slug)
    return isWeightValid(weight) && weight > 0
  }).length
  const poolValid = activeInPool >= 2
  const invalidMessage = !lengthValid
    ? peptidovkaStrings.invalidLength
    : !secondsValid
      ? peptidovkaStrings.invalidSeconds
      : !weightsValid
        ? peptidovkaStrings.invalidWeight
        : !poolValid
          ? peptidovkaStrings.invalidPool
          : null

  const setWeightText = (slug: string, text: string) => {
    setWeightTexts((current) => ({ ...current, [slug]: text }))
  }

  const save = async () => {
    if (saving || invalidMessage !== null || minLen === undefined || maxLen === undefined) return
    // Only current-pool slugs go out — a complete snapshot including zeros —
    // so the teacher can always re-save over drifted settings.
    const postedWeights: Record<string, number> = {}
    for (const molecule of pool) {
      const weight = parsedWeights.get(molecule.slug)
      if (!isWeightValid(weight)) return
      postedWeights[molecule.slug] = weight
    }
    setSaving(true)
    try {
      await biomoleculesApi.updatePeptidovkaSettings(settings.mode, {
        minLen,
        maxLen,
        secondsPerAa: seconds ?? 0,
        weights: postedWeights,
      })
      toast({ title: peptidovkaStrings.settingsSaved, variant: "default" })
    } catch (error) {
      toast({
        title: peptidovkaStrings.settingsSaveError,
        description: extractErrorMessage(error, peptidovkaStrings.settingsSaveError),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor={`${settings.mode}-min-len`}>{peptidovkaStrings.minLenLabel}</Label>
            <Input
              id={`${settings.mode}-min-len`}
              type="number"
              inputMode="numeric"
              min={LENGTH_MIN}
              max={LENGTH_MAX}
              step={1}
              value={minLenText}
              onChange={(event) => setMinLenText(event.target.value)}
              aria-invalid={!lengthValid}
              className="max-w-[8rem] tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${settings.mode}-max-len`}>{peptidovkaStrings.maxLenLabel}</Label>
            <Input
              id={`${settings.mode}-max-len`}
              type="number"
              inputMode="numeric"
              min={LENGTH_MIN}
              max={LENGTH_MAX}
              step={1}
              value={maxLenText}
              onChange={(event) => setMaxLenText(event.target.value)}
              aria-invalid={!lengthValid}
              className="max-w-[8rem] tabular-nums"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${settings.mode}-seconds`}>
              {peptidovkaStrings.secondsPerAaLabel}
            </Label>
            <Input
              id={`${settings.mode}-seconds`}
              type="number"
              inputMode="numeric"
              min={SECONDS_MIN}
              max={SECONDS_MAX}
              step={1}
              value={secondsText}
              onChange={(event) => setSecondsText(event.target.value)}
              aria-invalid={!secondsValid}
              className="max-w-[8rem] tabular-nums"
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm font-medium">{peptidovkaStrings.poolLabel}</p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {peptidovkaStrings.poolSelected
                .replace("{selected}", String(activeInPool))
                .replace("{total}", String(pool.length))}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">{peptidovkaStrings.poolHint}</p>
          <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 xl:grid-cols-3">
            {pool.map((molecule) => {
              // The pool filter guarantees oneLetter; the badge column
              // anchors each row so the inputs stay scannable.
              const oneLetter = traitOf(molecule, TRAIT.oneLetter) ?? ""
              const weightText = weightTexts[molecule.slug] ?? formatWeight(DEFAULT_WEIGHT)
              const weight = parsedWeights.get(molecule.slug)
              const weightValid = isWeightValid(weight)
              const off = weight === 0
              return (
                <div
                  key={molecule.id}
                  className="flex items-center gap-3 rounded-[4px] px-1.5 py-1 transition-colors duration-150 hover:bg-muted/50"
                >
                  <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">
                    {oneLetter}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      off && "text-muted-foreground",
                    )}
                  >
                    <RichText text={molecule.name} />
                  </span>
                  <Input
                    id={`${settings.mode}-weight-${molecule.slug}`}
                    type="text"
                    inputMode="decimal"
                    value={weightText}
                    onChange={(event) => setWeightText(molecule.slug, event.target.value)}
                    onBlur={() => {
                      // Canonicalize only complete, in-range values. Invalid
                      // text stays visible so it can be corrected, not coerced.
                      if (weightValid && weight !== undefined) {
                        setWeightText(molecule.slug, formatWeight(weight))
                      }
                    }}
                    aria-label={molecule.name}
                    aria-invalid={!weightValid}
                    autoComplete="off"
                    className="w-20 shrink-0 px-2 text-right font-mono tabular-nums"
                  />
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t pt-4">
          <Button onClick={() => void save()} disabled={saving || invalidMessage !== null}>
            {saving ? peptidovkaStrings.savingSettings : peptidovkaStrings.saveSettings}
          </Button>
          {invalidMessage !== null && (
            <p className="text-sm text-destructive" aria-live="polite">
              {invalidMessage}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * The teacher's Peptidovka settings: one card per mode. Settings are
 * fetched once per page mount; a save posts the whole mode payload and the
 * local draft already IS the saved state, so no refetch is needed.
 */
export function PeptidovkaSettingsPage() {
  const { toast } = useToast()
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)

  const [settings, setSettings] = useState<PeptidovkaSettings[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    biomoleculesApi
      .peptidovkaSettings()
      .then((rows) => {
        if (!cancelled) setSettings(rows)
      })
      .catch((error) => {
        if (cancelled) return
        setLoadFailed(true)
        toast({
          title: peptidovkaStrings.settingsLoadError,
          description: extractErrorMessage(error, peptidovkaStrings.settingsLoadError),
          variant: "destructive",
        })
      })
    return () => {
      cancelled = true
    }
  }, [toast])

  // The selectable pool: amino acids carrying a one-letter code, in the
  // category's own display order — the same playability rule the run uses.
  const pool = useMemo(
    () =>
      allMolecules.filter(
        (molecule) =>
          PEPTIDE_FAMILY_SLUGS.includes(molecule.categorySlug) &&
          traitOf(molecule, TRAIT.oneLetter) !== undefined,
      ),
    [allMolecules],
  )

  if (!loaded || (settings === null && !loadFailed)) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {peptidovkaStrings.title}
          </h1>
          <p className="text-sm text-muted-foreground">{peptidovkaStrings.settingsDescription}</p>
        </div>
        {[0, 1].map((i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-24 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {peptidovkaStrings.title}
        </h1>
        <p className="text-sm text-muted-foreground">{peptidovkaStrings.settingsDescription}</p>
      </div>

      {/* Assigned tests: prominent at the top, above the per-mode settings. */}
      <Card>
        <CardHeader>
          <CardTitle>{cs.peptidovka.testy.teacherTitle}</CardTitle>
          <CardDescription>{cs.peptidovka.testy.teacherDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/biomolekuly/peptidovka/testy/vytvorit">
              {cs.peptidovka.testy.createAction}
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/biomolekuly/peptidovka/testy/vysledky">
              {cs.biomolekuly.testy.listTitle}
            </Link>
          </Button>
        </CardContent>
      </Card>

      {loadFailed ? (
        <Card>
          <CardContent className="py-4">
            <p className="text-center text-destructive">{peptidovkaStrings.settingsLoadError}</p>
          </CardContent>
        </Card>
      ) : pool.length === 0 ? (
        <Card>
          <CardContent className="space-y-4 py-10 text-center">
            <div className="space-y-2">
              <p className="font-medium">{peptidovkaStrings.poolEmptyTitle}</p>
              <p className="text-sm text-muted-foreground">
                {peptidovkaStrings.poolEmptyDescription}
              </p>
            </div>
            <Button variant="outline" asChild>
              <Link to="/biomolekuly">{peptidovkaStrings.poolEmptyAction}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        settings?.map((row) => (
          // Keyed by mode: the draft state inside initializes from the
          // fetched row exactly once, at mount.
          <PeptidovkaModeSection key={row.mode} settings={row} pool={pool} />
        ))
      )}
    </div>
  )
}
