import { cva } from "class-variance-authority"
// Icons from lucide-react
import { Check, Clock, Eye, FileText, FlaskConical, RefreshCw } from "lucide-react"
import { useCallback, useState } from "react"
// Import shadcn/ui components
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
// Sub-components
import { CategorySelector } from "@/components/wizard/category-selector"
import { ExportPreview } from "@/components/wizard/export-preview"
import { TemplateAssignment } from "@/components/wizard/template-assignment"
import { VariantGenerator } from "@/components/wizard/variant-generator"
// Czech translations
import { cs } from "@/i18n/cs"
// Import types
import type { Category, ExportInput } from "@/lib/types"
import { cn } from "@/lib/utils"

// Step types
// Icons from lucide-react
type Step = {
  id: number
  label: string
  description: string
  icon: React.ReactNode
}

const pageContainerVariants = cva("space-y-6")

const stepperContainerVariants = cva("flex items-center justify-between")

const stepContainerVariants = cva("flex items-center gap-4")

const stepCircleVariants = cva(
  "flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300",
  {
    variants: {
      status: {
        active: "bg-primary text-primary-foreground border-primary",
        completed: "bg-secondary text-secondary-foreground border-secondary",
        pending: "bg-background text-foreground-muted border-border",
      },
    },
    defaultVariants: {
      status: "pending",
    },
  },
)

const stepLineVariants = cva("flex-1 h-2 rounded-full transition-all duration-300", {
  variants: {
    completed: {
      true: "bg-secondary",
      false: "bg-border",
    },
  },
  defaultVariants: {
    completed: false,
  },
})

const stepLabelVariants = cva("text-sm transition-colors duration-300", {
  variants: {
    status: {
      active: "text-foreground font-medium",
      completed: "text-secondary",
      pending: "text-foreground-muted",
    },
  },
  defaultVariants: {
    status: "pending",
  },
})

const contentSectionVariants = cva("py-8")

// Stepper steps configuration
const steps: Step[] = [
  {
    id: 1,
    label: cs.wizard.steps.selectCategory,
    description: cs.wizard.category.description,
    icon: <FlaskConical className="size-5" />,
  },
  {
    id: 2,
    label: cs.wizard.steps.chooseTemplates,
    description: cs.wizard.templatesSelection.description,
    icon: <FileText className="size-5" />,
  },
  {
    id: 3,
    label: cs.wizard.steps.configureSettings,
    description: cs.wizard.settings.description,
    icon: <RefreshCw className="size-5" />,
  },
  {
    id: 4,
    label: cs.wizard.steps.generateTasks,
    description: cs.wizard.generation.description,
    icon: <Clock className="size-5" />,
  },
  {
    id: 5,
    label: cs.wizard.steps.reviewOutput,
    description: cs.wizard.review.description,
    icon: <Eye className="size-5" />,
  },
]

export function WizardPage() {
  // Current step
  const [currentStep, setCurrentStep] = useState(1)

  // Step data
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [templateAssignments, setTemplateAssignments] = useState<Map<string, string[]>>(new Map())
  const [exportInput, setExportInput] = useState<ExportInput | null>(null)

  // Navigation handlers
  const handleSelectCategory = useCallback((category: Category) => {
    setSelectedCategory(category)
    setCurrentStep(2)
  }, [])

  const handleAssignTemplates = useCallback((assignments: Map<string, string[]>) => {
    setTemplateAssignments(assignments)
    setCurrentStep(3)
  }, [])

  const handleGenerateVariants = useCallback((input: ExportInput) => {
    setExportInput(input)
    setCurrentStep(5) // Skip to preview for now, step 4 is handled internally
  }, [])

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }, [currentStep])

  const handleComplete = useCallback(() => {
    // Reset and go back to step 1
    setSelectedCategory(null)
    setTemplateAssignments(new Map())
    setExportInput(null)
    setCurrentStep(1)
  }, [])

  // Render current step content
  const renderStepContent = useCallback(() => {
    switch (currentStep) {
      case 1:
        return (
          <CategorySelector
            selectedCategory={selectedCategory}
            onCategorySelect={handleSelectCategory}
          />
        )

      case 2:
        if (!selectedCategory) return null
        return (
          <TemplateAssignment
            category={selectedCategory}
            onNext={handleAssignTemplates}
            onBack={handleBack}
          />
        )

      case 3:
        return (
          <VariantGenerator
            templateAssignments={templateAssignments}
            onNext={handleGenerateVariants}
            onBack={handleBack}
          />
        )

      case 4:
        return (
          <div className="text-center py-8">
            <p className="text-foreground-muted">Generating variants...</p>
          </div>
        )

      case 5:
        if (!exportInput) return null
        return (
          <ExportPreview
            exportInput={exportInput}
            onBack={handleBack}
            onComplete={handleComplete}
          />
        )

      default:
        return null
    }
  }, [
    currentStep,
    selectedCategory,
    templateAssignments,
    exportInput,
    handleSelectCategory,
    handleAssignTemplates,
    handleGenerateVariants,
    handleBack,
    handleComplete,
  ])

  return (
    <div className={cn(pageContainerVariants())}>
      {/* Page header */}
      <div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {cs.wizard.title}
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">{cs.wizard.description}</p>
        </div>
      </div>

      {/* Stepper */}
      <div className={cn(contentSectionVariants())}>
        <Card>
          <CardHeader>
            <CardTitle>Průvodce generováním</CardTitle>
            <CardDescription>
              Postupujte podle jednotlivých kroků pro vytvoření nových úkolů.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Progress bar */}
            <div className="mb-6">
              <Progress value={(currentStep / steps.length) * 100} className="h-2" />
              <p className="text-xs text-foreground-muted mt-2">
                Krok {currentStep} z {steps.length}
              </p>
            </div>

            {/* Stepper */}
            <div className={cn(stepperContainerVariants())}>
              {steps.map((step, index) => {
                const isActive = step.id === currentStep
                const isCompleted = step.id < currentStep

                return (
                  <div key={step.id} className={cn(stepContainerVariants())}>
                    {/* Step circle */}
                    <div
                      className={cn(
                        stepCircleVariants({
                          status: isActive ? "active" : isCompleted ? "completed" : "pending",
                        }),
                      )}
                    >
                      {isCompleted ? <Check className="size-5" /> : step.icon}
                    </div>

                    {/* Step label */}
                    <div className="flex flex-col gap-1 min-w-[150px]">
                      <span
                        className={cn(
                          stepLabelVariants({
                            status: isActive ? "active" : isCompleted ? "completed" : "pending",
                          }),
                        )}
                      >
                        {step.label}
                      </span>
                      <span className="text-xs text-foreground-muted hidden sm:block">
                        {step.description}
                      </span>
                    </div>

                    {/* Step line (not for last step) */}
                    {index < steps.length - 1 && (
                      <div className={cn(stepLineVariants({ completed: isCompleted }))} />
                    )}
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Step content */}
      <div className={cn(contentSectionVariants())}>
        <Card>
          <CardHeader>
            <CardTitle>{steps[currentStep - 1].label}</CardTitle>
            <CardDescription>{steps[currentStep - 1].description}</CardDescription>
          </CardHeader>
          <CardContent>{renderStepContent()}</CardContent>
        </Card>
      </div>

      {/* Action buttons - shown only in some steps */}
      {currentStep === 1 && (
        <div className="flex justify-between gap-4">
          <Button variant="outline" onClick={() => /* Cancel */ {}}>
            {cs.common.cancel}
          </Button>
        </div>
      )}
    </div>
  )
}
