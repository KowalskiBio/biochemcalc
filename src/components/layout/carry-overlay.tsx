import { useCarryStore } from "@/stores/drag-store"

export function CarryOverlay() {
  const isCarrying = useCarryStore((s) => s.isCarrying)
  const kind = useCarryStore((s) => s.kind)
  const template = useCarryStore((s) => s.template)
  const set = useCarryStore((s) => s.set)
  const topic = useCarryStore((s) => s.topic)
  const mouseX = useCarryStore((s) => s.mouseX)
  const mouseY = useCarryStore((s) => s.mouseY)

  if (!isCarrying || kind === null) return null

  const label =
    kind === "question" ? "↕ Nesená otázka" : kind === "set" ? "↕ Nesená sada" : "↕ Nesené téma"
  const content =
    kind === "question"
      ? template?.questionText.slice(0, 120)
      : kind === "set"
        ? set
          ? `Sada ${set.setIndex}${set.name ? ` — ${set.name}` : ""}`
          : ""
        : (topic?.name ?? "")

  return (
    <div
      className="pointer-events-none fixed z-[100] max-w-sm rounded-lg border-2 border-primary bg-background/95 shadow-xl p-3"
      style={{
        left: mouseX + 16,
        top: mouseY + 16,
      }}
    >
      <p className="text-xs font-medium text-primary mb-1">{label}</p>
      <p className="text-sm text-foreground line-clamp-2">{content}</p>
    </div>
  )
}
