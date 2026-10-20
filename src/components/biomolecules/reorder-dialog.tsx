import { ArrowDown, ArrowUp, Loader2 } from "lucide-react"
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
import { extractErrorMessage } from "@/lib/http"

const manage = cs.biomolekuly.manage

export interface ReorderItem {
  id: string
  label: string
  /** Secondary text, e.g. the topic a category sits under. */
  hint?: string
}

interface ReorderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** Every item, in the current order. */
  items: ReorderItem[]
  /** Saves the new order (all ids); the server refuses a stale one. */
  onSave: (ids: string[]) => Promise<void>
}

/**
 * Teacher: put topics, categories or one category's molecules in a new order
 * with up/down buttons. Nothing is sent until "save".
 */
export function ReorderDialog({ open, onOpenChange, title, items, onSave }: ReorderDialogProps) {
  const { toast } = useToast()
  const [order, setOrder] = useState<ReorderItem[]>(items)
  const [saving, setSaving] = useState(false)

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the dialog opens — a live `items` refresh mustn't discard the user's unsaved moves
  useEffect(() => {
    if (open) setOrder(items)
  }, [open])

  const move = (index: number, by: -1 | 1) => {
    setOrder((current) => {
      const next = [...current]
      const [item] = next.splice(index, 1)
      next.splice(index + by, 0, item)
      return next
    })
  }

  const unchanged = order.every((item, index) => item.id === items[index]?.id)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(order.map((item) => item.id))
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{manage.reorderDescription}</DialogDescription>
        </DialogHeader>

        <ol className="divide-y divide-border rounded-[4px] border border-border">
          {order.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className="w-6 shrink-0 font-mono tabular text-xs text-muted-foreground">
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.label}</p>
                {item.hint && <p className="truncate text-xs text-muted-foreground">{item.hint}</p>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                aria-label={manage.moveUp}
                title={manage.moveUp}
                disabled={index === 0 || saving}
                onClick={() => move(index, -1)}
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
                disabled={index === order.length - 1 || saving}
                onClick={() => move(index, 1)}
              >
                <ArrowDown className="size-4" strokeWidth={1.75} />
              </Button>
            </li>
          ))}
        </ol>

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
