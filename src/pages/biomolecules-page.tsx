import { ArrowLeft, ChevronRight } from "lucide-react"
import { useState } from "react"
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
import { getMoleculeCategory, MOLECULE_CATEGORIES } from "@/lib/molecules"
import { AMINO_ACIDS, type AminoAcid } from "@/lib/molecules/amino-acids"
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

/** Hub: one card per molecule category; only aminokyseliny has content today. */
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

/**
 * One category's browse view. Today only the amino-acid family has content,
 * so this renders its bespoke cards (side-chain badge, essential marker) and
 * detail dialog over the AMINO_ACIDS dataset; a new family slots in its own
 * view next to this one and the registry routes to it.
 */
export function BiomoleculesCategoryPage() {
  const { categoryId } = useParams<{ categoryId: string }>()
  const category = getMoleculeCategory(categoryId ?? "")
  const [selected, setSelected] = useState<AminoAcid | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

  const openDetail = (aa: AminoAcid) => {
    setSelected(aa)
    setIsDetailOpen(true)
  }

  if (!category) {
    return <Navigate to="/biomolekuly" replace />
  }

  const copy = getCategoryCopy(category.id)

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
            <Button asChild size="sm">
              <Link to={`/biomolekuly/${category.id}/procvicovani`}>
                {cs.biomolekuly.quiz.practice}
              </Link>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{copy.description}</p>
      </div>

      {/* Amino acid grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {AMINO_ACIDS.map((aa) => (
          <button
            key={aa.id}
            type="button"
            onClick={() => openDetail(aa)}
            className={cn(
              "flex h-full cursor-pointer flex-col items-center gap-3 rounded-[4px] border bg-card p-4 text-center",
              "transition-colors duration-150 hover:border-primary/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            )}
          >
            <div aria-hidden="true" className="flex items-center justify-center">
              <StructureView smiles={aa.smiles} size={140} title={aa.name} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm font-semibold tracking-tight">{aa.name}</div>
              <div className="font-mono tabular text-xs text-muted-foreground">
                {aa.oneLetter} · {aa.threeLetter}
              </div>
            </div>
            <div className="mt-auto flex flex-wrap items-center justify-center gap-1.5">
              <Badge variant="secondary">{cs.biomolekuly.sideChainLabels[aa.sideChain]}</Badge>
              {aa.essential && (
                <Badge variant="outline" className="border-accent/50 text-accent">
                  {cs.biomolekuly.essentialBadge}
                </Badge>
              )}
            </div>
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
                <DialogDescription>
                  <span className="font-mono tabular">
                    {selected.oneLetter} · {selected.threeLetter}
                  </span>
                  {" — "}
                  {cs.biomolekuly.sideChainLabels[selected.sideChain]}
                </DialogDescription>
              </DialogHeader>

              <div className="flex justify-center">
                <StructureView smiles={selected.smiles} size={260} title={selected.name} />
              </div>

              {/* Meta rows */}
              <dl className="divide-y divide-border rounded-[4px] border">
                <div className="flex items-center justify-between px-3 py-2">
                  <dt className="text-sm text-muted-foreground">
                    {cs.biomolekuly.detail.sideChainLabel}
                  </dt>
                  <dd className="text-sm font-medium">
                    {cs.biomolekuly.sideChainLabels[selected.sideChain]}
                  </dd>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <dt className="text-sm text-muted-foreground">
                    {cs.biomolekuly.detail.chargeLabel}
                  </dt>
                  <dd className="text-sm font-medium">
                    {cs.biomolekuly.chargeLabels[selected.chargeAtPh7]}
                  </dd>
                </div>
                <div className="flex items-center justify-between px-3 py-2">
                  <dt className="text-sm text-muted-foreground">
                    {cs.biomolekuly.detail.essentialLabel}
                  </dt>
                  <dd className={cn("text-sm font-medium", selected.essential && "text-accent")}>
                    {selected.essential ? cs.biomolekuly.detail.yes : cs.biomolekuly.detail.no}
                  </dd>
                </div>
              </dl>

              {/* Facts */}
              <div>
                <h3 className="text-sm font-semibold">{cs.biomolekuly.detail.factsLabel}</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {selected.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
