import { ArrowDown, ArrowDownAZ, ArrowUp, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { compareMoleculeNames } from "@/lib/biomolecule-order"
import { extractErrorMessage } from "@/lib/http"

const manage = cs.biomolekuly.manage

export interface ReorderItem {
  id: string
  label: string
}

/** A titled group of items, e.g. one topic's categories. */
export interface ReorderSection {
  title: string
  items: ReorderItem[]
}

interface ReorderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Every item, in the current order (flat mode). Ignored when `sections` is given. */
  items?: ReorderItem[]
  /**
   * Grouped rendering (e.g. categories under their topic): moves stay inside
   * one section and saving concatenates the sections in order. When given,
   * `items` is ignored.
   */
  sections?: ReorderSection[]
  /** Shows a button that sorts the current (unsaved) dialog order A–Z. */
  sortAlphabeticalLabel?: string
  /** Saves the new order (all ids); the server refuses a stale one. */
  onSave: (ids: string[]) => Promise<void>
}

/**
 * Teacher: put topics, categories or one category's molecules in a new order
 * with up/down buttons. Nothing is sent until "save".
 */
export function ReorderDialog({
  open,
  onOpenChange,
  title,
  items = [],
  sections,
  sortAlphabeticalLabel,
  onSave,
}: ReorderDialogProps) {
  const { toast } = useToast()
  const [order, setOrder] = useState<ReorderItem[]>(items)
  const [sectionOrder, setSectionOrder] = useState<ReorderSection[]>(sections ?? [])
  const [saving, setSaving] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens — a live `items`/`sections` refresh mustn't discard the user's unsaved moves
  useEffect(() => {
    if (open) {
      setOrder(items)
      setSectionOrder(sections ?? [])
    }
  }, [open])

  const move = (index: number, by: -1 | 1) => {
    setOrder((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item)
      return next
    })
  }

  const moveInSection = (sectionIndex: number, index: number, by: -1 | 1) => {
    setSectionOrder((current) => {
      const next = [...current]
      const sectionItems = [...next[sectionIndex].items]
      const [item] = sectionItems.splice(index, 1)
      sectionItems.splice(index + by, 0, item)
      next[sectionIndex] = { ...next[sectionIndex], items: sectionItems }
      return next
    })
  }

  // Stable sort: `compareMoleculeNames` returns 0 for equal keys, so ties keep
  // their relative order. In sections mode each section is sorted separately —
  // the topic grouping isn't touched.
  const sortAlphabetically = () => {
    const byName = (a: ReorderItem, b: ReorderItem) => compareMoleculeNames(a.label, b.label)
    if (sections) {
      setSectionOrder((current) =>
        current.map((section) => ({ ...section, items: [...section.items].sort(byName) })),
      )
    } else {
      setOrder((current) => [...current].sort(byName))
    }
  }

  const baseline = sections ? sections.flatMap((section) => section.items) : items
  const current = sections ? sectionOrder.flatMap((section) => section.items) : order
  const unchanged = current.every((item, index) => item.id === baseline[index]?.id)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(current.map((item) => item.id))
      toast({ title: manage.orderSaved })
      onOpenChange(false)
    } catch (error) {
      toast({
        title: manage.orderError,
        description: extractErrorMessage(error, ""),
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const renderRow = (
    item: ReorderItem,
    position: number,
    isFirst: boolean,
    isLast: boolean,
    onMove: (by: -1 | 1) => void,
  ) => (
    <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-6 shrink-0 font-mono tabular text-xs text-muted-foreground">
        {position}.
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.label}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={manage.moveUp}
        title={manage.moveUp}
        disabled={isFirst || saving}
        onClick={() => onMove(-1)}
      >
        <ArrowUp className="size-4" strokeWidth={1.75} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={manage.moveDown}
        title={manage.moveDown}
        disabled={isLast || saving}
        onClick={() => onMove(1)}
      >
        <ArrowDown className="size-4" strokeWidth={1.75} />
      </Button>
    </li>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{manage.reorderDescription}</DialogDescription>
        </DialogHeader>

        {sortAlphabeticalLabel && (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={sortAlphabetically}
            >
              <ArrowDownAZ className="size-4 mr-1.5" strokeWidth={1.75} />
              {sortAlphabeticalLabel}
            </Button>
          </div>
        )}

        {sections ? (
          <div className="space-y-4">
            {sectionOrder.map((section, sectionIndex) => (
              <section key={section.title}>
                <h3 className="mb-1.5 text-sm font-semibold tracking-tight text-muted-foreground">
                  {section.title}
                </h3>
                <ol className="divide-y divide-border rounded-[4px] border border-border">
                  {section.items.map((item, index) =>
                    renderRow(
                      item,
                      index + 1,
                      index === 0,
                      index === section.items.length - 1,
                      (by) => moveInSection(sectionIndex, index, by),
                    ),
                  )}
                </ol>
              </section>
            ))}
          </div>
        ) : (
          <ol className="divide-y divide-border rounded-[4px] border border-border">
            {order.map((item, index) =>
              renderRow(item, index + 1, index === 0, index === order.length - 1, (by) =>
                move(index, by),
              ),
            )}
          </ol>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {manage.cancelAction}
          </Button>
          <Button onClick={() => void handleSave()} disabled={unchanged || saving}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            {manage.saveOrder}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
