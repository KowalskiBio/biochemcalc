import { ArrowLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ProjectionView } from "@/components/ui/projection-view"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { StructureView } from "@/components/ui/structure-view"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError } from "@/lib/api"
import type { Biomolecule, BiomoleculeTraits, CategoryField } from "@/lib/biomolecules-api"
import { moleculeFacts, TRAIT, traitOf } from "@/lib/molecules"
import {
  generatableQuizTypes,
  getCategoryQuizConfig,
  type QuizQuestionType,
} from "@/lib/molecules/quiz"
import { parseProjection, type ProjectionSpec } from "@/lib/molecules/render/projection"
import { cn } from "@/lib/utils"
import { useAuthStore } from "@/stores/auth-store"
import {
  builtInCategoryText,
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useCategoryDescriptions,
  useCategoryMolecules,
  useCategoryNames,
  useMoleculeCategories,
  useMoleculeCategory,
} from "@/stores/biomolecule-data-store"

const quizStrings = cs.biomolekuly.quiz
const manage = cs.biomolekuly.manage

function moleculeCountLabel(count: number): string {
  return cs.biomolekuly.categoryCount.replace("{count}", String(count))
}

const cardButtonClass = cn(
  "group flex cursor-pointer items-start gap-4 rounded-[4px] border bg-card p-5 text-left",
  "transition-colors duration-150 hover:border-primary/50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
)

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

/** Which display/management variant a category uses (protected slugs). */
type CategoryKind = "aminoAcids" | "nitrogenBases" | "custom"

function categoryKind(categoryId: string): CategoryKind {
  if (categoryId === "aminokyseliny") return "aminoAcids"
  if (categoryId === "dusikate-baze") return "nitrogenBases"
  return "custom"
}

/** Hub: one card per category, plus the teacher's new-category card. */
export function BiomoleculesPage() {
  const navigate = useNavigate()
  const isTeacher = useAuthStore((s) => s.user?.role === "teacher")
  const categories = useMoleculeCategories()
  const loaded = useBiomoleculeDataLoaded()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)
  const nameOf = useCategoryNames()
  const descriptionOf = useCategoryDescriptions()
  const [createOpen, setCreateOpen] = useState(false)

  // The hub-level practice link applies only while some category can actually
  // generate questions. Students only: TeacherRoutes has no
  // /biomolekuly/procvicovani route, so teachers keep the per-category link.
  const anyQuizTypes = useMemo(
    () =>
      categories.some((category) => {
        const config = getCategoryQuizConfig(
          category.slug,
          allMolecules.filter((molecule) => molecule.categorySlug === category.slug),
        )
        return (
          config !== undefined &&
          generatableQuizTypes(config.molecules, config.characteristics).length > 0
        )
      }),
    [categories, allMolecules],
  )

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.biomolekuly.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{cs.biomolekuly.pageDescription}</p>
        </div>
        {!isTeacher && anyQuizTypes && (
          <Button asChild size="sm" className="mt-1 shrink-0">
            <Link to="/biomolekuly/procvicovani">{quizStrings.practice}</Link>
          </Button>
        )}
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {!loaded && categories.length === 0
          ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-[4px]" />)
          : categories.map((category) => (
              <button
                key={category.slug}
                type="button"
                onClick={() => navigate(`/biomolekuly/${category.slug}`)}
                className={cardButtonClass}
              >
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="font-semibold tracking-tight">{nameOf(category.slug)}</span>
                  <span className="font-mono tabular text-xs text-muted-foreground">
                    {moleculeCountLabel(category.moleculeCount)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {descriptionOf(category.slug)}
                  </span>
                </div>
                <ChevronRight
                  className="ml-auto mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
                  strokeWidth={1.75}
                />
              </button>
            ))}

        {isTeacher && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className={cn(
              cardButtonClass,
              "items-center justify-center border-dashed text-muted-foreground",
            )}
          >
            <Plus className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="text-sm font-medium">{manage.addCategory}</span>
          </button>
        )}
      </div>

      <CreateCategoryDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  )
}

/** Teacher's new-category dialog. The server derives the slug from the name. */
function CreateCategoryDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const createCategory = useBiomoleculeDataStore((s) => s.createCategory)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setName("")
      setDescription("")
    }
  }, [open])

  const handleSubmit = async () => {
    const trimmed = name.trim()
    if (!trimmed || saving) return
    try {
      setSaving(true)
      const data = await createCategory(trimmed, description.trim() || null)
      setCreateOpenSafe(false)
      toast({ title: manage.createCategorySuccess })
      const created = data.categories.find((category) => category.name === trimmed)
      if (created) navigate(`/biomolekuly/${created.slug}`)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: manage.createError, description: message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const setCreateOpenSafe = onOpenChange

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{manage.addCategoryTitle}</DialogTitle>
          <DialogDescription>{manage.addCategoryDescription}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-category-name">{manage.categoryNameLabel}</Label>
            <Input
              id="new-category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={manage.categoryNamePlaceholder}
              maxLength={80}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSubmit()
              }}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-category-description">{manage.categoryDescriptionLabel}</Label>
            <Input
              id="new-category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={manage.categoryDescriptionPlaceholder}
              maxLength={300}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {manage.cancelAction}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!name.trim() || saving}>
              {manage.createCategory}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One label/value row in the molecule detail dialog. */
interface DetailRow {
  label: string
  value: ReactNode
  valueClassName?: string
}

/**
 * Per-kind display bits fed into the shared grid/card/dialog below. Every
 * bit sees plain `Biomolecule`s and reads traits, so a teacher-made category
 * works through the generic record.
 */
interface CategoryBits {
  /** Mono micro-line under the card name ("A · Ala", "T"). */
  cardCodeLine: (molecule: Biomolecule) => string
  /** Chips pinned to the bottom of the card; omit for a leaner card. */
  cardBadges?: (molecule: Biomolecule) => ReactNode
  /** Subtitle under the molecule name in the detail dialog. */
  dialogDescription: (molecule: Biomolecule) => ReactNode
  /** Meta rows in the detail dialog, above the facts list. */
  detailRows: (molecule: Biomolecule, molecules?: Biomolecule[]) => DetailRow[]
}

const labels = cs.biomolekuly

function codeLine(molecule: Biomolecule, withOneLetter: boolean): string {
  const oneLetter = traitOf(molecule, TRAIT.oneLetter)
  const abbreviation = traitOf(molecule, TRAIT.abbreviation)
  if (withOneLetter && oneLetter) {
    return abbreviation ? `${oneLetter} · ${abbreviation}` : oneLetter
  }
  return abbreviation ?? oneLetter ?? ""
}

function monoRow(label: string, value: string): DetailRow {
  return { label, value: <span className="font-mono tabular">{value}</span> }
}

function labelRow(label: string, value: string): DetailRow {
  return { label, value }
}

function essentialRow(molecule: Biomolecule): DetailRow {
  const essential = traitOf(molecule, TRAIT.essential) === "true"
  return {
    label: labels.detail.essentialLabel,
    value: essential ? labels.detail.yes : labels.detail.no,
    valueClassName: essential ? "text-accent" : undefined,
  }
}

function traitLabel(map: Record<string, string>, value: string | undefined): string | undefined {
  return value ? map[value] : undefined
}

/**
 * Reads a sugar trait (`anomer`/`ringForm`/`deoxy`) straight off the record,
 * with `traitOf`'s guard against blank values. These keys aren't part of the
 * shared TRAIT vocabulary yet (that lands with lane B), so the constant
 * lookup can't be used.
 */
function rawTrait(molecule: Biomolecule, key: string): string | undefined {
  const value = molecule.traits[key]
  return value && value.trim().length > 0 ? value : undefined
}

const aminoAcidBits: CategoryBits = {
  cardCodeLine: (molecule) => codeLine(molecule, true),
  cardBadges: (molecule) => (
    <>
      {traitOf(molecule, TRAIT.sideChain) && (
        <Badge variant="secondary">
          {traitLabel(labels.sideChainLabels, traitOf(molecule, TRAIT.sideChain))}
        </Badge>
      )}
      {traitOf(molecule, TRAIT.essential) === "true" && (
        <Badge variant="outline" className="border-accent/50 text-accent">
          {labels.essentialBadge}
        </Badge>
      )}
    </>
  ),
  dialogDescription: (molecule) => (
    <>
      <span className="font-mono tabular">{codeLine(molecule, true)}</span>
      {traitOf(molecule, TRAIT.sideChain) && (
        <>
          {" — "}
          {traitLabel(labels.sideChainLabels, traitOf(molecule, TRAIT.sideChain))}
        </>
      )}
    </>
  ),
  detailRows: (molecule) =>
    [
      traitOf(molecule, TRAIT.sideChain) &&
        labelRow(
          labels.detail.sideChainLabel,
          traitLabel(labels.sideChainLabels, traitOf(molecule, TRAIT.sideChain)) ?? "",
        ),
      traitOf(molecule, TRAIT.charge) &&
        labelRow(
          labels.detail.chargeLabel,
          traitLabel(labels.chargeLabels, traitOf(molecule, TRAIT.charge)) ?? "",
        ),
      essentialRow(molecule),
    ].filter((row): row is DetailRow => Boolean(row)),
}

const nitrogenBaseBits: CategoryBits = {
  cardCodeLine: (molecule) => traitOf(molecule, TRAIT.abbreviation) ?? "",
  dialogDescription: (molecule) =>
    traitLabel(labels.ringSystemLabels, traitOf(molecule, TRAIT.ringSystem)) ?? "",
  detailRows: (molecule, molecules) => {
    const pairsWith = traitOf(molecule, TRAIT.pairsWith)
    const rows: DetailRow[] = []
    const abbreviation = traitOf(molecule, TRAIT.abbreviation)
    if (abbreviation) rows.push(monoRow(labels.detail.abbreviationLabel, abbreviation))
    const ringSystem = traitLabel(labels.ringSystemLabels, traitOf(molecule, TRAIT.ringSystem))
    if (ringSystem) rows.push(labelRow(labels.detail.ringSystemLabel, ringSystem))
    if (pairsWith) {
      const names = pairsWith
        .split(",")
        .map((slug) => molecules?.find((m) => m.slug === slug)?.name ?? slug)
        .join(", ")
      rows.push(labelRow(labels.detail.pairingLabel, names))
    }
    const inDna = traitOf(molecule, TRAIT.inDna) === "true"
    const inRna = traitOf(molecule, TRAIT.inRna) === "true"
    if (inDna || inRna) {
      rows.push({
        label: labels.detail.occurrenceLabel,
        value: (
          <span className="flex gap-1.5">
            {inDna && (
              <Badge variant="secondary" className="font-mono">
                DNA
              </Badge>
            )}
            {inRna && (
              <Badge variant="secondary" className="font-mono">
                RNA
              </Badge>
            )}
          </span>
        ),
      })
    }
    return rows
  },
}

/** Custom categories show whatever traits the teacher filled in. */
const customBits: CategoryBits = {
  cardCodeLine: (molecule) => codeLine(molecule, false),
  cardBadges: (molecule) => (
    <>
      {traitOf(molecule, TRAIT.polarity) && (
        <Badge variant="secondary">
          {traitLabel(labels.polarityLabels, traitOf(molecule, TRAIT.polarity))}
        </Badge>
      )}
      {traitOf(molecule, TRAIT.essential) === "true" && (
        <Badge variant="outline" className="border-accent/50 text-accent">
          {labels.essentialBadge}
        </Badge>
      )}
    </>
  ),
  dialogDescription: (molecule) =>
    [
      traitLabel(labels.polarityLabels, traitOf(molecule, TRAIT.polarity)),
      traitLabel(labels.chargeLabels, traitOf(molecule, TRAIT.charge)),
      traitLabel(labels.sideChainLabels, traitOf(molecule, TRAIT.sideChain)),
      traitLabel(labels.ringSystemLabels, traitOf(molecule, TRAIT.ringSystem)),
      traitLabel(labels.anomerLabels, rawTrait(molecule, "anomer")),
      traitLabel(labels.ringFormLabels, rawTrait(molecule, "ringForm")),
    ]
      .filter(Boolean)
      .join(" · "),
  detailRows: (molecule, molecules) => {
    const rows: DetailRow[] = []
    const oneLetter = traitOf(molecule, TRAIT.oneLetter)
    const abbreviation = traitOf(molecule, TRAIT.abbreviation)
    if (oneLetter) rows.push(monoRow(manage.oneLetterLabel, oneLetter))
    if (abbreviation) rows.push(monoRow(labels.detail.abbreviationLabel, abbreviation))
    const charge = traitLabel(labels.chargeLabels, traitOf(molecule, TRAIT.charge))
    if (charge) rows.push(labelRow(labels.detail.chargeLabel, charge))
    const polarity = traitLabel(labels.polarityLabels, traitOf(molecule, TRAIT.polarity))
    if (polarity) rows.push(labelRow(labels.detail.polarityLabel, polarity))
    const sideChain = traitLabel(labels.sideChainLabels, traitOf(molecule, TRAIT.sideChain))
    if (sideChain) rows.push(labelRow(labels.detail.sideChainLabel, sideChain))
    const ringSystem = traitLabel(labels.ringSystemLabels, traitOf(molecule, TRAIT.ringSystem))
    if (ringSystem) rows.push(labelRow(labels.detail.ringSystemLabel, ringSystem))
    // Sugar traits ride the same row plumbing (labels + value maps in
    // `cs.biomolekuly`); each row only appears when the molecule carries
    // the trait, so teacher-made categories are unaffected.
    const anomer = traitLabel(labels.anomerLabels, rawTrait(molecule, "anomer"))
    if (anomer) rows.push(labelRow(labels.detail.anomerLabel, anomer))
    const ringForm = traitLabel(labels.ringFormLabels, rawTrait(molecule, "ringForm"))
    if (ringForm) rows.push(labelRow(labels.detail.ringFormLabel, ringForm))
    const deoxy = traitLabel(labels.deoxyLabels, rawTrait(molecule, "deoxy"))
    if (deoxy) rows.push(labelRow(labels.detail.deoxyLabel, deoxy))
    if (
      traitOf(molecule, TRAIT.essential) === "true" ||
      traitOf(molecule, TRAIT.sulfur) === "true"
    ) {
      rows.push(essentialRow(molecule))
    }
    const pairsWith = traitOf(molecule, TRAIT.pairsWith)
    if (pairsWith) {
      const names = pairsWith
        .split(",")
        .map((slug) => molecules?.find((m) => m.slug === slug)?.name ?? slug)
        .join(", ")
      rows.push(labelRow(labels.detail.pairingLabel, names))
    }
    return rows
  },
}

function bitsFor(kind: CategoryKind): CategoryBits {
  if (kind === "aminoAcids") return aminoAcidBits
  if (kind === "nitrogenBases") return nitrogenBaseBits
  return customBits
}

/**
 * Shared browse view for one category: card grid plus detail dialog. The
 * per-kind display strings and row/chip content come from `bits`; teachers
 * additionally get edit/delete actions inside the dialog.
 */
function MoleculeBrowser({
  categoryId,
  kind,
  molecules,
  bits,
}: {
  categoryId: string
  kind: CategoryKind
  molecules: Biomolecule[]
  bits: CategoryBits
}) {
  const { toast } = useToast()
  const isTeacher = useAuthStore((s) => s.user?.role === "teacher")
  const deleteMolecule = useBiomoleculeDataStore((s) => s.deleteMolecule)
  const [selected, setSelected] = useState<Biomolecule | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const openDetail = (molecule: Biomolecule) => {
    setSelected(molecule)
    setIsDetailOpen(true)
  }

  const handleDelete = async () => {
    if (!selected || deleting) return
    try {
      setDeleting(true)
      await deleteMolecule(selected.id)
      setDeleteOpen(false)
      setIsDetailOpen(false)
      toast({ title: manage.deleteSuccess })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: manage.deleteError, description: message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  // Raw projection strings parse once per dataset change; a card or the
  // detail dialog then draws the molecule's Haworth projection whenever it
  // carries one.
  const projections = useMemo(() => {
    const map = new Map<string, ProjectionSpec>()
    for (const molecule of molecules) {
      const spec = parseProjection(molecule.projection)
      if (spec !== null) map.set(molecule.id, spec)
    }
    return map
  }, [molecules])

  const facts = selected ? moleculeFacts(selected) : []

  return (
    <>
      {/* Molecule grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {molecules.map((molecule) => (
          <button
            key={molecule.id}
            type="button"
            onClick={() => openDetail(molecule)}
            className={cn(
              "flex h-full cursor-pointer flex-col items-center gap-3 rounded-[4px] border bg-card p-4 text-center",
              "transition-colors duration-150 hover:border-primary/50",
              FOCUS_RING_CLASS,
            )}
          >
            <div aria-hidden="true" className="flex items-center justify-center">
              <StructureView
                smiles={molecule.smiles}
                projection={projections.get(molecule.id)}
                size={140}
                title={molecule.name}
              />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold tracking-tight">{molecule.name}</div>
              <div className="font-mono tabular text-xs text-muted-foreground">
                {bits.cardCodeLine(molecule)}
              </div>
            </div>
            {bits.cardBadges && (
              <div className="mt-auto flex flex-wrap items-center justify-center gap-1.5">
                {bits.cardBadges(molecule)}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* Detail dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="sm:max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
                <DialogDescription>{bits.dialogDescription(selected)}</DialogDescription>
              </DialogHeader>

              <div className="flex justify-center">
                <StructureView
                  smiles={selected.smiles}
                  projection={projections.get(selected.id)}
                  size={260}
                  title={selected.name}
                />
              </div>

              {/* Meta rows */}
              <dl className="divide-y divide-border rounded-[4px] border">
                {bits.detailRows(selected, molecules).map((row) => (
                  <div key={row.label} className="flex items-center justify-between px-3 py-2">
                    <dt className="text-sm text-muted-foreground">{row.label}</dt>
                    <dd className={cn("text-sm font-medium", row.valueClassName)}>{row.value}</dd>
                  </div>
                ))}
              </dl>

              {/* Facts */}
              {facts.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold">{labels.detail.factsLabel}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </div>
              )}

              {isTeacher && (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setDeleteOpen(true)
                    }}
                  >
                    <Trash2 className="size-4 mr-1.5" strokeWidth={1.75} />
                    {manage.deleteMolecule}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setFormOpen(true)
                    }}
                  >
                    <Pencil className="size-4 mr-1.5" strokeWidth={1.75} />
                    {manage.editMolecule}
                  </Button>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <MoleculeFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        categoryId={categoryId}
        kind={kind}
        molecule={selected}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={manage.deleteMoleculeTitle}
        description={manage.deleteMoleculeDescription.replace("{name}", selected?.name ?? "")}
        confirmLabel={manage.deleteAction}
        cancelLabel={manage.cancelAction}
        onConfirm={() => void handleDelete()}
      />
    </>
  )
}

/** Shared class for the toggle buttons of flag traits. */
const flagButtonClass = (active: boolean) =>
  cn(
    "min-h-[36px] cursor-pointer rounded-[4px] border px-3 text-sm font-medium",
    "transition-colors duration-150",
    FOCUS_RING_CLASS,
    active
      ? "border-primary bg-primary/10 text-primary"
      : "bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground",
  )

/** Add/edit molecule dialog: name + SMILES mandatory, traits optional per kind. */
function MoleculeFormDialog({
  open,
  onOpenChange,
  categoryId,
  kind,
  molecule,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  categoryId: string
  kind: CategoryKind
  /** null = create mode */
  molecule: Biomolecule | null
}) {
  const { toast } = useToast()
  const createMolecule = useBiomoleculeDataStore((s) => s.createMolecule)
  const updateMolecule = useBiomoleculeDataStore((s) => s.updateMolecule)
  const [name, setName] = useState("")
  const [smiles, setSmiles] = useState("")
  const [smilesValid, setSmilesValid] = useState(true)
  const [abbreviation, setAbbreviation] = useState("")
  const [oneLetter, setOneLetter] = useState("")
  const [charge, setCharge] = useState("")
  const [polarity, setPolarity] = useState("")
  const [sideChain, setSideChain] = useState("")
  const [ringSystem, setRingSystem] = useState("")
  const [pairsWith, setPairsWith] = useState("")
  const [essential, setEssential] = useState(false)
  const [sulfur, setSulfur] = useState(false)
  const [inDna, setInDna] = useState(false)
  const [inRna, setInRna] = useState(false)
  const [facts, setFacts] = useState("")
  const [saving, setSaving] = useState(false)

  // The saved record's projection, parsed once per molecule: when present it
  // — not the SMILES field — is the structure the preview must show.
  const savedProjection = useMemo(
    () => parseProjection(molecule?.projection),
    [molecule?.projection],
  )

  useEffect(() => {
    if (!open) return
    setName(molecule?.name ?? "")
    setSmiles(molecule?.smiles ?? "")
    setSmilesValid(true)
    setAbbreviation(molecule ? (traitOf(molecule, TRAIT.abbreviation) ?? "") : "")
    setOneLetter(molecule ? (traitOf(molecule, TRAIT.oneLetter) ?? "") : "")
    setCharge(molecule ? (traitOf(molecule, TRAIT.charge) ?? "") : "")
    setPolarity(molecule ? (traitOf(molecule, TRAIT.polarity) ?? "") : "")
    setSideChain(molecule ? (traitOf(molecule, TRAIT.sideChain) ?? "") : "")
    setRingSystem(molecule ? (traitOf(molecule, TRAIT.ringSystem) ?? "") : "")
    setPairsWith(molecule ? (traitOf(molecule, TRAIT.pairsWith) ?? "") : "")
    setEssential(molecule ? traitOf(molecule, TRAIT.essential) === "true" : false)
    setSulfur(molecule ? traitOf(molecule, TRAIT.sulfur) === "true" : false)
    setInDna(molecule ? traitOf(molecule, TRAIT.inDna) === "true" : false)
    setInRna(molecule ? traitOf(molecule, TRAIT.inRna) === "true" : false)
    setFacts(molecule ? moleculeFacts(molecule).join("\n") : "")
  }, [open, molecule])

  const canSave = name.trim().length > 0 && smiles.trim().length > 0 && smilesValid && !saving

  const handleSubmit = async () => {
    if (!canSave) return
    const traits: BiomoleculeTraits = {}
    const put = (key: string, value: string) => {
      if (value.trim()) traits[key] = value.trim()
    }
    put(TRAIT.abbreviation, abbreviation)
    if (kind === "aminoAcids") {
      put(TRAIT.oneLetter, oneLetter)
      put(TRAIT.sideChain, sideChain)
      if (sulfur) traits[TRAIT.sulfur] = "true"
      if (essential) traits[TRAIT.essential] = "true"
    }
    if (kind === "nitrogenBases") {
      put(TRAIT.ringSystem, ringSystem)
      put(TRAIT.pairsWith, pairsWith)
      if (inDna) traits[TRAIT.inDna] = "true"
      if (inRna) traits[TRAIT.inRna] = "true"
    }
    if (kind === "custom") {
      put(TRAIT.polarity, polarity)
      if (essential) traits[TRAIT.essential] = "true"
    }
    put(TRAIT.charge, charge)
    put(TRAIT.facts, facts)

    try {
      setSaving(true)
      if (molecule) {
        // Forward the stored projection so an ordinary name/SMILES/traits
        // edit can't silently wipe a molecule's Haworth depiction.
        await updateMolecule(molecule.id, name.trim(), smiles.trim(), traits, molecule.projection)
      } else {
        await createMolecule(categoryId, name.trim(), smiles.trim(), traits)
      }
      toast({ title: manage.saveSuccess })
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: molecule ? manage.saveError : manage.createError,
        description: message,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const enumOptions = (map: Record<string, string>) =>
    Object.entries(map).map(([value, optionLabel]) => (
      <SelectItem key={value} value={value}>
        {optionLabel}
      </SelectItem>
    ))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{molecule ? manage.editMoleculeTitle : manage.addMoleculeTitle}</DialogTitle>
          <DialogDescription>{manage.requiredHint}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="molecule-name">{manage.moleculeNameLabel}</Label>
              <Input
                id="molecule-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={manage.moleculeNamePlaceholder}
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="molecule-abbreviation">{manage.abbreviationLabel}</Label>
              <Input
                id="molecule-abbreviation"
                value={abbreviation}
                onChange={(e) => setAbbreviation(e.target.value)}
                placeholder={manage.abbreviationPlaceholder}
                maxLength={12}
                className="font-mono"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="molecule-smiles">{manage.smilesLabel}</Label>
            <Input
              id="molecule-smiles"
              value={smiles}
              onChange={(e) => setSmiles(e.target.value)}
              placeholder={manage.smilesPlaceholder}
              maxLength={300}
              className={cn("font-mono", !smilesValid && "border-destructive")}
            />
            {/* A saved projection outranks the typed SMILES in the preview —
                the spec itself is read-only here, so a hint says so. */}
            {savedProjection ? (
              <div className="flex justify-center rounded-[4px] border p-3">
                <ProjectionView
                  spec={savedProjection}
                  ariaLabel={name.trim() || smiles.trim()}
                />
              </div>
            ) : smiles.trim() ? (
              // Keep the preview mounted for ANY non-empty SMILES — only a
              // mounted StructureView can report validity again after a typo.
              <div className="flex justify-center rounded-[4px] border p-3">
                <StructureView
                  smiles={smiles.trim()}
                  size={180}
                  title={smiles.trim()}
                  onValidityChange={setSmilesValid}
                />
              </div>
            ) : null}
            {/* With a projection on screen the visible preview no longer
                reports SMILES validity, so a hidden StructureView keeps the
                save-guard (`canSave`) alive for the typed SMILES. */}
            {savedProjection && smiles.trim() !== "" && (
              <div className="hidden" aria-hidden="true">
                <StructureView
                  smiles={smiles.trim()}
                  size={180}
                  title={smiles.trim()}
                  onValidityChange={setSmilesValid}
                />
              </div>
            )}
            {savedProjection && (
              <p className="text-xs text-muted-foreground">{manage.projectionReadonlyHint}</p>
            )}
            {smiles.trim() && !smilesValid && (
              <p className="text-sm text-destructive">{manage.smilesInvalid}</p>
            )}
            {smiles.trim() === "" && <span className="hidden" />}
          </div>

          {kind === "aminoAcids" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="molecule-one-letter">{manage.oneLetterLabel}</Label>
                <Input
                  id="molecule-one-letter"
                  value={oneLetter}
                  onChange={(e) => setOneLetter(e.target.value)}
                  maxLength={1}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>{manage.sideChainLabel}</Label>
                <Select
                  value={sideChain || "unset"}
                  onValueChange={(v) => setSideChain(v === "unset" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">{manage.unsetOption}</SelectItem>
                    {enumOptions(labels.sideChainLabels)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {kind === "nitrogenBases" && (
            <>
              <div className="space-y-2">
                <Label>{manage.ringSystemLabel}</Label>
                <Select
                  value={ringSystem || "unset"}
                  onValueChange={(v) => setRingSystem(v === "unset" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">{manage.unsetOption}</SelectItem>
                    {enumOptions(labels.ringSystemLabels)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="molecule-pairs">{manage.pairsWithLabel}</Label>
                <Input
                  id="molecule-pairs"
                  value={pairsWith}
                  onChange={(e) => setPairsWith(e.target.value)}
                  placeholder={manage.pairsWithPlaceholder}
                  className="font-mono"
                />
                <p className="text-xs text-muted-foreground">{manage.pairsWithHint}</p>
              </div>
            </>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{manage.chargeLabel}</Label>
              <Select
                value={charge || "unset"}
                onValueChange={(v) => setCharge(v === "unset" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unset">{manage.unsetOption}</SelectItem>
                  {enumOptions(labels.chargeLabels)}
                </SelectContent>
              </Select>
            </div>
            {kind === "custom" && (
              <div className="space-y-2">
                <Label>{manage.polarityLabel}</Label>
                <Select
                  value={polarity || "unset"}
                  onValueChange={(v) => setPolarity(v === "unset" ? "" : v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">{manage.unsetOption}</SelectItem>
                    {enumOptions(labels.polarityLabels)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {(kind === "aminoAcids" || kind === "nitrogenBases" || kind === "custom") && (
            <div className="flex flex-wrap gap-2">
              {kind !== "nitrogenBases" && (
                <button
                  type="button"
                  aria-pressed={essential}
                  onClick={() => setEssential((v) => !v)}
                  className={flagButtonClass(essential)}
                >
                  {manage.essentialLabel}
                </button>
              )}
              {kind === "aminoAcids" && (
                <button
                  type="button"
                  aria-pressed={sulfur}
                  onClick={() => setSulfur((v) => !v)}
                  className={flagButtonClass(sulfur)}
                >
                  {manage.sulfurLabel}
                </button>
              )}
              {kind === "nitrogenBases" && (
                <>
                  <button
                    type="button"
                    aria-pressed={inDna}
                    onClick={() => setInDna((v) => !v)}
                    className={flagButtonClass(inDna)}
                  >
                    {manage.dnaLabel}
                  </button>
                  <button
                    type="button"
                    aria-pressed={inRna}
                    onClick={() => setInRna((v) => !v)}
                    className={flagButtonClass(inRna)}
                  >
                    {manage.rnaLabel}
                  </button>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="molecule-facts">{manage.factsLabel}</Label>
            <Textarea
              id="molecule-facts"
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              placeholder={manage.factsPlaceholder}
              rows={3}
              maxLength={1000}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {manage.cancelAction}
            </Button>
            <Button onClick={() => void handleSubmit()} disabled={!canSave}>
              {manage.saveMolecule}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One category's browse view: header, shared molecule browser, quiz link. */
const INLINE_TEXT_STYLES: Record<
  CategoryField,
  { display: string; input: string; maxLength: number }
> = {
  name: {
    display: "text-2xl font-semibold tracking-tight text-foreground",
    input: "text-2xl font-semibold h-auto py-0",
    maxLength: 80,
  },
  description: {
    display: "text-sm text-muted-foreground mt-1",
    input: "text-sm h-auto py-0 mt-1",
    maxLength: 300,
  },
}

/**
 * A category's name or description. Teachers edit it inline exactly like a
 * topic title (`topic-detail-page.tsx`): click the text, Enter or blur saves,
 * Escape cancels. The new text is stored server-side and shows for everyone.
 */
function InlineCategoryText({
  categoryId,
  field,
  value,
}: {
  categoryId: string
  field: CategoryField
  value: string
}) {
  const { toast } = useToast()
  const isTeacher = useAuthStore((s) => s.user?.role === "teacher")
  const update = useBiomoleculeDataStore((s) => s.updateCategoryMeta)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const styles = INLINE_TEXT_STYLES[field]
  const Tag = field === "name" ? "h1" : "p"

  const handleSave = useCallback(async () => {
    const trimmed = draft.trim()
    // A name can't be blank (descriptions can); an unchanged value needs no write.
    if (!trimmed || trimmed === value) {
      setIsEditing(false)
      return
    }
    try {
      setSaving(true)
      // Typing the built-in text back just stores it — there is no override
      // layer anymore, the category row holds the text directly.
      await update(
        categoryId,
        field,
        field === "description" && trimmed === builtInCategoryText(categoryId, field)
          ? null
          : trimmed,
      )
      toast({ title: cs.topics.renameSuccess })
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: cs.topics.renameError, description: message, variant: "destructive" })
    } finally {
      setSaving(false)
      setIsEditing(false)
    }
  }, [categoryId, field, value, draft, update, toast])

  if (!isTeacher) {
    return <Tag className={styles.display}>{value}</Tag>
  }

  return isEditing ? (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleSave}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleSave()
        if (e.key === "Escape") setIsEditing(false)
      }}
      disabled={saving}
      maxLength={styles.maxLength}
      autoFocus
      className={styles.input}
    />
  ) : (
    <Tag className={styles.display}>
      <button
        type="button"
        className="cursor-pointer hover:ring-2 hover:ring-primary/30 rounded px-1 -mx-1 text-left"
        onClick={() => {
          setDraft(value)
          setIsEditing(true)
        }}
      >
        {value}
        <Pencil className="size-3 inline ml-2 text-muted-foreground opacity-0 hover:opacity-100" />
      </button>
    </Tag>
  )
}

export function BiomoleculesCategoryPage() {
  const { categoryId = "" } = useParams<{ categoryId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const isTeacher = useAuthStore((s) => s.user?.role === "teacher")
  const loaded = useBiomoleculeDataLoaded()
  const category = useMoleculeCategory(categoryId)
  const molecules = useCategoryMolecules(categoryId)
  const nameOf = useCategoryNames()
  const descriptionOf = useCategoryDescriptions()
  const deleteCategory = useBiomoleculeDataStore((s) => s.deleteCategory)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const kind = categoryKind(categoryId)
  const bits = bitsFor(kind)
  const quizTypes: QuizQuestionType[] = (() => {
    const config = getCategoryQuizConfig(categoryId, molecules)
    // Offer the quiz only when the category can actually generate questions.
    return config ? generatableQuizTypes(config.molecules, config.characteristics) : []
  })()

  const handleDeleteCategory = async () => {
    if (deleting) return
    try {
      setDeleting(true)
      await deleteCategory(categoryId)
      setDeleteOpen(false)
      toast({ title: manage.deleteSuccess })
      navigate("/biomolekuly")
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({ title: manage.deleteError, description: message, variant: "destructive" })
    } finally {
      setDeleting(false)
    }
  }

  // Wait for the first load before judging a slug — otherwise a direct link
  // would bounce to the hub while the dataset is still being fetched.
  if (loaded && !category) {
    return <Navigate to="/biomolekuly" replace />
  }

  if (!category) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48 rounded-[4px]" />
        <Skeleton className="h-24 rounded-[4px]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link
        to="/biomolekuly"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[4px] text-sm text-muted-foreground",
          "transition-colors duration-150 hover:text-foreground",
          FOCUS_RING_CLASS,
        )}
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {cs.biomolekuly.backToCategories}
      </Link>

      {/* Category header */}
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <InlineCategoryText
            categoryId={category.slug}
            field="name"
            value={nameOf(category.slug)}
          />
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap font-mono tabular text-sm text-muted-foreground">
              {moleculeCountLabel(category.moleculeCount)}
            </span>
            {isTeacher && (
              <>
                <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="size-4 mr-1.5" strokeWidth={1.75} />
                  {manage.deleteCategory}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
                  <Plus className="size-4 mr-1.5" strokeWidth={1.75} />
                  {manage.addMolecule}
                </Button>
              </>
            )}
            {quizTypes.length > 0 && (
              <Button asChild size="sm">
                <Link to={`/biomolekuly/${category.slug}/procvicovani`}>
                  {quizStrings.practice}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <InlineCategoryText
          categoryId={category.slug}
          field="description"
          value={descriptionOf(category.slug)}
        />
      </div>

      <MoleculeBrowser categoryId={category.slug} kind={kind} molecules={molecules} bits={bits} />

      <MoleculeFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        categoryId={category.slug}
        kind={kind}
        molecule={null}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={manage.deleteCategoryTitle}
        description={manage.deleteCategoryDescription.replace("{name}", nameOf(category.slug))}
        confirmLabel={manage.deleteAction}
        cancelLabel={manage.cancelAction}
        onConfirm={() => void handleDeleteCategory()}
      />
    </div>
  )
}
