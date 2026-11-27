import { ChevronRight, Crown, Dna, Layers, Swords } from "lucide-react"
import { Link } from "react-router-dom"

import { AssignedTestsSection } from "@/components/biomolecules/assigned-tests"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cs } from "@/i18n/cs"
import { PEPTIDE_FAMILY_SLUGS } from "@/lib/molecules"
import { generatableQuizTypes, getCategoryQuizConfig } from "@/lib/molecules/quiz"
import {
  ATOM_COLOR_NITROGEN,
  ATOM_COLOR_OXYGEN,
  ATOM_COLOR_SULFUR,
} from "@/lib/molecules/render/atom-palette"
import { cn } from "@/lib/utils"
import {
  useBiomoleculeDataLoaded,
  useBiomoleculeDataStore,
  useMoleculeCategories,
  useMoleculeTopics,
  useTopicText,
} from "@/stores/biomolecule-data-store"

const testStrings = cs.biomolekuly.test

const FOCUS_RING_CLASS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"

const TILE_CLASS = cn(
  "flex min-h-[44px] items-center justify-between gap-2 rounded-[4px] border bg-card px-3 py-2 text-left text-sm font-medium",
  "transition-colors duration-150 hover:border-primary hover:bg-primary/5",
  FOCUS_RING_CLASS,
)

/** The three heteroatom letters that make the colour/no-colour difference visible at a glance. */
function AtomLetters({ coloured }: { coloured: boolean }) {
  const atoms = [
    { letter: "N", color: ATOM_COLOR_NITROGEN },
    { letter: "O", color: ATOM_COLOR_OXYGEN },
    { letter: "S", color: ATOM_COLOR_SULFUR },
  ]
  return (
    <span aria-hidden="true" className="flex gap-1 font-mono text-sm font-semibold">
      {atoms.map(({ letter, color }) => (
        <span key={letter} style={coloured ? { color } : undefined}>
          {letter}
        </span>
      ))}
    </span>
  )
}

/**
 * Peptidovka inside the Učeň block: one tile split down the middle. The
 * coloured half is the easier Učeň run (atoms colour-coded, N-terminus on
 * the left); the black-and-white half is the Mistr run (one ink, random
 * rotation).
 */
function PeptidovkaSplitTile() {
  const halves = [
    {
      to: "/biomolekuly/test/peptidovka/ucen",
      coloured: true,
      label: cs.test.modeUcenTitle,
      hint: cs.peptidovka.modeUcenDescription,
    },
    {
      to: "/biomolekuly/test/peptidovka/mistr",
      coloured: false,
      label: cs.test.modeMistrTitle,
      hint: cs.peptidovka.modeMistrDescription,
    },
  ]
  return (
    <div className="rounded-[4px] border bg-card sm:col-span-2">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <Dna className="size-4 text-primary" strokeWidth={1.75} />
        <span className="text-sm font-medium">{cs.peptidovka.title}</span>
      </div>
      <div className="grid grid-cols-2 divide-x">
        {halves.map(({ to, coloured, label, hint }) => (
          <Link
            key={to}
            to={to}
            title={hint}
            className={cn(
              "flex min-h-[56px] flex-col items-start justify-center gap-1 px-3 py-2",
              "transition-colors duration-150 hover:bg-primary/5",
              coloured ? "rounded-bl-[4px]" : "rounded-br-[4px] bg-muted/40",
              FOCUS_RING_CLASS,
            )}
          >
            <AtomLetters coloured={coloured} />
            <span className="text-sm font-medium">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

/**
 * Učeň as a block that shows its choices right away: "all topics" first,
 * then every topic with easy-mode material, then Peptidovka. Picking one
 * starts the run — there is nothing else to configure.
 */
function UcenBlock() {
  const loaded = useBiomoleculeDataLoaded()
  const topics = useMoleculeTopics()
  const categories = useMoleculeCategories()
  const allMolecules = useBiomoleculeDataStore((s) => s.molecules)
  const { nameOf } = useTopicText()

  const playableTopics = topics.filter((topic) =>
    categories.some((category) => {
      if (category.topicSlug !== topic.slug) return false
      const config = getCategoryQuizConfig(
        category.slug,
        allMolecules.filter((molecule) => molecule.categorySlug === category.slug),
      )
      return (
        config != null && generatableQuizTypes(config.molecules, config.characteristics).length > 0
      )
    }),
  )
  const hasPeptidovka = categories.some((category) => PEPTIDE_FAMILY_SLUGS.includes(category.slug))

  return (
    <Card className="h-full lg:col-span-2">
      <CardHeader className="space-y-4">
        <div className="space-y-1.5">
          <Swords className="size-6 text-primary" strokeWidth={1.75} />
          <CardTitle className="text-lg">{cs.test.modeUcenTitle}</CardTitle>
          <CardDescription>{testStrings.modeUcenTopicDescription}</CardDescription>
        </div>

        {!loaded ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <Skeleton key={item} className="h-11 rounded-[4px]" />
            ))}
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <Link to="/biomolekuly/test/ucen" className={TILE_CLASS}>
              <span className="flex items-center gap-2">
                <Layers className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {testStrings.allTopics}
              </span>
              <ChevronRight className="size-4 text-muted-foreground" strokeWidth={1.75} />
            </Link>
            {playableTopics.map((topic) => (
              <Link
                key={topic.slug}
                to={`/biomolekuly/test/ucen?tema=${encodeURIComponent(topic.slug)}`}
                className={TILE_CLASS}
              >
                <span className="min-w-0 truncate">{nameOf(topic.slug)}</span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.75}
                />
              </Link>
            ))}
            {hasPeptidovka && <PeptidovkaSplitTile />}
          </div>
        )}
      </CardHeader>
    </Card>
  )
}

/**
 * Biomolekuly's test hub: Učeň with its topics laid out in the block, Mistr
 * across everything, then the teacher-assigned, once-only tests (classic and
 * Peptidovka) whose attempts live on the server.
 */
export function BiomoleculesTestPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.test.startTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.test.modePickerDescription}</p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <UcenBlock />
        <Link to="/biomolekuly/test/mistr" className="block h-full">
          <Card className="h-full cursor-pointer transition-colors hover:border-primary hover:bg-primary/5">
            <CardHeader>
              <Crown className="size-6 text-primary" strokeWidth={1.75} />
              <CardTitle className="text-lg">{cs.test.modeMistrTitle}</CardTitle>
              <CardDescription>{testStrings.modeMistrDescription}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      <AssignedTestsSection />
    </div>
  )
}
