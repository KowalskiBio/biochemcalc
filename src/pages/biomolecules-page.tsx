import { ArrowLeft, ChevronRight } from "lucide-react"
import { type ReactNode, useState } from "react"
import { Link, Navigate, useNavigate, useParams } from "react-router-dom"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { StructureView } from "@/components/ui/structure-view"
import { cs } from "@/i18n/cs"
import { getMoleculeCategory, MOLECULE_CATEGORIES, type MoleculeBase } from "@/lib/molecules"
import { AMINO_ACIDS, type AminoAcid } from "@/lib/molecules/amino-acids"
import {
  getNitrogenBaseById,
  NITROGEN_BASES,
  type NitrogenBase,
} from "@/lib/molecules/nitrogen-bases"
import { getCategoryQuizConfig } from "@/lib/molecules/quiz"
import { cn } from "@/lib/utils"

const CATEGORY_COPY: Record<string, { name: string; description: string }> =
  cs.biomolekuly.categories

/** Display strings for a category; falls back to the slug if cs is behind the data. */
function getCategoryCopy(id: string): { name: string; description: string } {
  return CATEGORY_COPY[id] ?? { name: id, description: "" }
}

function moleculeCountLabel(count: number): string {
  return cs.biomolekuly.categoryCount.replace("{count}", String(count))
}

const cardButtonClass = cn(
  "group flex cursor-pointer items-start gap-4 rounded-[4px] border bg-card p-5 text-left",
  "transition-colors duration-150 hover:border-primary/50",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
)

/** Hub: one card per molecule category registered in MOLECULE_CATEGORIES. */
export function BiomoleculesPage() {
  const navigate = useNavigate()

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.biomolekuly.title}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">{cs.biomolekuly.pageDescription}</p>
      </div>

      {/* Category grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {MOLECULE_CATEGORIES.map((category) => {
          const copy = getCategoryCopy(category.id)
          return (
            <button
              key={category.id}
              type="button"
              onClick={() => navigate(`/biomolekuly/${category.id}`)}
              className={cardButtonClass}
            >
              <div className="flex min-w-0 flex-col gap-1.5">
                <span className="font-semibold tracking-tight">{copy.name}</span>
                <span className="font-mono tabular text-xs text-muted-foreground">
                  {moleculeCountLabel(category.molecules.length)}
                </span>
                <span className="text-sm text-muted-foreground">{copy.description}</span>
              </div>
              <ChevronRight
                className="ml-auto mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground"
                strokeWidth={1.75}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** One label/value row in the molecule detail dialog. */
interface DetailRow {
  label: string
  value: ReactNode
  valueClassName?: string
}

/**
 * Per-family display bits fed into the shared grid/card/dialog below. Each
 * registered category supplies one of these next to the category switch; the
 * bits only see that family's own dataset type, so extending a family means
 * touching exactly one record.
 */
interface CategoryBits<M extends MoleculeBase> {
  /** Mono micro-line under the card name ("A · Ala", "A"). */
  cardCodeLine: (molecule: M) => string
  /** Chips pinned to the bottom of the card; omit for a leaner card. */
  cardBadges?: (molecule: M) => ReactNode
  /** Subtitle under the molecule name in the detail dialog. */
  dialogDescription: (molecule: M) => ReactNode
  /** Meta rows in the detail dialog, above the facts list. */
  detailRows: (molecule: M) => DetailRow[]
}

const aminoAcidBits: CategoryBits<AminoAcid> = {
  cardCodeLine: (aa) => `${aa.oneLetter} · ${aa.threeLetter}`,
  cardBadges: (aa) => (
    <>
      <Badge variant="secondary">{cs.biomolekuly.sideChainLabels[aa.sideChain]}</Badge>
      {aa.essential && (
        <Badge variant="outline" className="border-accent/50 text-accent">
          {cs.biomolekuly.essentialBadge}
        </Badge>
      )}
    </>
  ),
  dialogDescription: (aa) => (
    <>
      <span className="font-mono tabular">
        {aa.oneLetter} · {aa.threeLetter}
      </span>
      {" — "}
      {cs.biomolekuly.sideChainLabels[aa.sideChain]}
    </>
  ),
  detailRows: (aa) => [
    {
      label: cs.biomolekuly.detail.sideChainLabel,
      value: cs.biomolekuly.sideChainLabels[aa.sideChain],
    },
    {
      label: cs.biomolekuly.detail.chargeLabel,
      value: cs.biomolekuly.chargeLabels[aa.chargeAtPh7],
    },
    {
      label: cs.biomolekuly.detail.essentialLabel,
      value: aa.essential ? cs.biomolekuly.detail.yes : cs.biomolekuly.detail.no,
      valueClassName: aa.essential ? "text-accent" : undefined,
    },
  ],
}

const nitrogenBaseBits: CategoryBits<NitrogenBase> = {
  cardCodeLine: (base) => base.abbreviation,
  dialogDescription: (base) => cs.biomolekuly.ringSystemLabels[base.ringSystem],
  detailRows: (base) => [
    {
      label: cs.biomolekuly.detail.abbreviationLabel,
      value: <span className="font-mono tabular">{base.abbreviation}</span>,
    },
    {
      label: cs.biomolekuly.detail.ringSystemLabel,
      value: cs.biomolekuly.ringSystemLabels[base.ringSystem],
    },
    {
      label: cs.biomolekuly.detail.pairingLabel,
      value: base.pairsWithIds.map((id) => getNitrogenBaseById(id)?.name ?? id).join(", "),
    },
    {
      label: cs.biomolekuly.detail.occurrenceLabel,
      value: (
        <span className="flex gap-1.5">
          {base.inDna && (
            <Badge variant="secondary" className="font-mono">
              DNA
            </Badge>
          )}
          {base.inRna && (
            <Badge variant="secondary" className="font-mono">
              RNA
            </Badge>
          )}
        </span>
      ),
    },
  ],
}

/**
 * Shared browse view for one molecule family: card grid plus detail dialog.
 * The family's display strings and row/chip content live in `bits`.
 */
function MoleculeBrowser<M extends MoleculeBase>({
  molecules,
  bits,
}: {
  molecules: M[]
  bits: CategoryBits<M>
}) {
  const [selected, setSelected] = useState<M | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const openDetail = (molecule: M) => {
    setSelected(molecule)
    setIsDetailOpen(true)
  }

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
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            <div aria-hidden="true" className="flex items-center justify-center">
              <StructureView smiles={molecule.smiles} size={140} title={molecule.name} />
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
                <StructureView smiles={selected.smiles} size={260} title={selected.name} />
              </div>

              {/* Meta rows */}
              <dl className="divide-y divide-border rounded-[4px] border">
                {bits.detailRows(selected).map((row) => (
                  <div key={row.label} className="flex items-center justify-between px-3 py-2">
                    <dt className="text-sm text-muted-foreground">{row.label}</dt>
                    <dd className={cn("text-sm font-medium", row.valueClassName)}>{row.value}</dd>
                  </div>
                ))}
              </dl>

              {/* Facts */}
              {selected.facts && selected.facts.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold">{cs.biomolekuly.detail.factsLabel}</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {selected.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Per-category descriptor switch: the registry routes here, each family
 * plugs its dataset into the shared browser with its display bits. A
 * registered category without an entry renders nothing (registry stays the
 * source of truth for what exists).
 */
function categoryContent(categoryId: string): ReactNode {
  switch (categoryId) {
    case "aminokyseliny":
      return <MoleculeBrowser molecules={AMINO_ACIDS} bits={aminoAcidBits} />
    case "dusikate-baze":
      return <MoleculeBrowser molecules={NITROGEN_BASES} bits={nitrogenBaseBits} />
    default:
      return null
  }
}

/** One category's browse view: header, shared molecule browser, quiz link. */
export function BiomoleculesCategoryPage() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const category = getMoleculeCategory(categoryId ?? "")

  if (!category) {
    return <Navigate to="/biomolekuly" replace />
  }

  const copy = getCategoryCopy(category.id)
  const content = categoryContent(category.id)
  const quizAvailable = getCategoryQuizConfig(category.id) !== undefined

  if (!content) {
    return <Navigate to="/biomolekuly" replace />
  }

  return (
    <div className="space-y-6">
      <Link
        to="/biomolekuly"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-[4px] text-sm text-muted-foreground",
          "transition-colors duration-150 hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <ArrowLeft className="size-4" strokeWidth={1.75} />
        {cs.biomolekuly.backToCategories}
      </Link>

      {/* Category header */}
      <div>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{copy.name}</h1>
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap font-mono tabular text-sm text-muted-foreground">
              {moleculeCountLabel(category.molecules.length)}
            </span>
            {quizAvailable && (
              <Button asChild size="sm">
                <Link to={`/biomolekuly/${category.id}/procvicovani`}>
                  {cs.biomolekuly.quiz.practice}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{copy.description}</p>
      </div>

      {content}
    </div>
  )
}
