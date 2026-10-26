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
import { AMINO_ACIDS_SLUG, TRAIT, traitOf } from "@/lib/molecules"
import { useBiomoleculeDataLoaded, useBiomoleculeDataStore } from "@/stores/biomolecule-data-store"

const peptidovkaStrings = cs.peptidovka

/** Server bounds, mirrored client-side. The server stays the authority. */
const LENGTH_MIN = 2
const LENGTH_MAX = 20
const SECONDS_MIN = 3
const SECONDS_MAX = 120

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
  const [slugs, setSlugs] = useState<string[]>(settings.slugs)
  const [saving, setSaving] = useState(false)

  const minLen = parseBound(minLenText)
  const maxLen = parseBound(maxLenText)
  const seconds = parseBound(secondsText)

  const lengthValid =
    minLen !== undefined &&
    maxLen !== undefined &&
    minLen >= LENGTH_MIN &&
    maxLen <= LENGTH_MAX &&
    maxLen >= minLen
  const secondsValid = seconds !== undefined && seconds >= SECONDS_MIN && seconds <= SECONDS_MAX
  // Count only slugs that are still selectable (a molecule may have been
  // deleted or stripped of oneLetter since the settings were saved).
  const selectedInPool = pool.filter((molecule) => slugs.includes(molecule.slug)).length
  const poolValid = selectedInPool >= 2
  const invalidMessage = !lengthValid
    ? peptidovkaStrings.invalidLength
    : !secondsValid
      ? peptidovkaStrings.invalidSeconds
      : !poolValid
        ? peptidovkaStrings.invalidPool
        : null

  const toggleSlug = (slug: string) => {
    setSlugs((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    )
  }

  const save = async () => {
    if (saving || invalidMessage !== null || minLen === undefined || maxLen === undefined) return
    setSaving(true)
    // A slug from an older save can outlive its molecule; posting it would
    // be rejected server-side. Only current-pool slugs go out, so the
    // teacher can always re-save over drifted settings.
    const postedSlugs = slugs.filter((slug) => pool.some((molecule) => molecule.slug === slug))
    try {
      await biomoleculesApi.updatePeptidovkaSettings(settings.mode, {
        minLen,
        maxLen,
        secondsPerAa: seconds ?? 0,
        slugs: postedSlugs,
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
                .replace("{selected}", String(selectedInPool))
                .replace("{total}", String(pool.length))}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
            {pool.map((molecule) => {
              const oneLetter = traitOf(molecule, TRAIT.oneLetter)
              return (
                <label
                  key={molecule.id}
                  className="flex cursor-pointer items-center gap-2 rounded-[4px] px-1 py-1 text-sm transition-colors duration-150 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={slugs.includes(molecule.slug)}
                    onChange={() => toggleSlug(molecule.slug)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0 truncate">
                    <RichText text={molecule.name} />
                  </span>
                  {oneLetter !== undefined && (
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {oneLetter}
                    </span>
                  )}
                </label>
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
          molecule.categorySlug === AMINO_ACIDS_SLUG &&
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
              <Link to={`/biomolekuly/${AMINO_ACIDS_SLUG}`}>
                {peptidovkaStrings.poolEmptyAction}
              </Link>
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
