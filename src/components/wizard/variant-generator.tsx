import { Clock, Download } from "lucide-react"
import { useCallback, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
// Import shadcn/ui components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
// Import hooks
import { useToast } from "@/hooks/use-toast"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { generationApi } from "@/lib/api"
import { formatNumberMaxDecimals } from "@/lib/math-utils"
import type {
  ExportInput,
  ExportQuestion,
  GenerateInput,
  Template,
  TemplateVariantResult,
  Variant,
} from "@/lib/types"

interface VariantGeneratorProps {
  templateAssignments: Map<string, string[]>
  onNext: (exportInput: ExportInput) => void
  onBack: () => void
}

export function VariantGenerator({ templateAssignments, onNext, onBack }: VariantGeneratorProps) {
  const { toast } = useToast()
  const [variantCount, setVariantCount] = useState<number>(5)
  const [baseSeed, setBaseSeed] = useState<number>(42)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationProgress, setGenerationProgress] = useState(0)
  const [generatedVariants, setGeneratedVariants] = useState<TemplateVariantResult[]>([])
  const [previewVariants, setPreviewVariants] = useState<Variant[]>([])
  const [selectedPreviewIndex, setSelectedPreviewIndex] = useState(0)
  const [filename, setFilename] = useState<string>(
    `biochemcalc_${new Date().toISOString().slice(0, 10)}`,
  )

  // Generate variants for all sets
  const handleGenerate = useCallback(async () => {
    try {
      setIsGenerating(true)
      setGenerationProgress(0)
      setGeneratedVariants([])

      const allTemplateIds: string[] = []
      for (const templateIds of templateAssignments.values()) {
        allTemplateIds.push(...templateIds)
      }

      // Generate variants for all templates at once
      const input: GenerateInput = {
        templateIds: allTemplateIds,
        count: variantCount,
        baseSeed: baseSeed,
        mode: "closed",
        difficulty: "medium",
        optionCount: 5,
      }

      setGenerationProgress(50)

      const results = await generationApi.generateForTemplates(input)
      setGeneratedVariants(results)
      setGenerationProgress(100)

      // Set preview to first few variants
      const firstVariants: Variant[] = []
      results.forEach((result) => {
        if (result.variants.length > 0) {
          firstVariants.push(result.variants[0])
        }
      })
      setPreviewVariants(firstVariants.slice(0, 3))

      toast({
        title: cs.toasts.success.generated,
        description: `Generated ${results.length * variantCount} variants successfully`,
      })
    } catch (err) {
      toast({
        title: "Generation Failed",
        description: err instanceof Error ? err.message : "Failed to generate variants",
        variant: "destructive",
      })
    } finally {
      setIsGenerating(false)
    }
  }, [templateAssignments, variantCount, baseSeed, toast])

  // Prepare export data
  const handleExport = useCallback(async () => {
    if (generatedVariants.length === 0) {
      toast({
        title: "Error",
        description: "No variants generated yet",
        variant: "destructive",
      })
      return
    }

    // Collect all templates
    const templates: Template[] = []
    for (const result of generatedVariants) {
      templates.push(result.template)
    }

    // Build export questions
    const questions: ExportQuestion[] = []
    for (const result of generatedVariants) {
      for (const variant of result.variants) {
        // Get variable precisions from template variables
        const variablePrecisions: Record<string, number> = {}
        // Default to 2 decimal places for all variables
        // In a real implementation, this would come from the template.variables

        questions.push({
          template: result.template,
          variant: variant,
          variablePrecisions: variablePrecisions,
          resultPrecision: 2, // Default precision
          mode: "closed",
        })
      }
    }

    const exportInput: ExportInput = {
      filename: filename.endsWith(".txt") ? filename : `${filename}.txt`,
      questions: questions,
    }

    onNext(exportInput)
  }, [generatedVariants, filename, toast, onNext])

   return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">Generate Variants</h3>
        <p className="text-sm text-muted-foreground">
          Configure the number of variants and seed for reproducible generation
        </p>
      </div>

      {/* Generation settings */}
      <Card>
        <CardHeader>
          <CardTitle>Generation Settings</CardTitle>
          <CardDescription>
            Configure how many variants to generate and the base seed
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="variantCount">Number of Variants per Template</Label>
            <Input
              id="variantCount"
              type="number"
              value={variantCount}
              onChange={(e) => setVariantCount(parseInt(e.target.value, 10) || 1)}
              min={1}
              max={100}
            />
             <p className="text-xs text-muted-foreground">
               Total variants:{" "}
               <span className="font-mono tabular">{variantCount *
                 Array.from(templateAssignments.values()).reduce((sum, ids) => sum + ids.length, 0)}</span>
             </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="baseSeed">Base Seed</Label>
            <Input
              id="baseSeed"
              type="number"
              value={baseSeed}
              onChange={(e) => setBaseSeed(parseInt(e.target.value, 10) || 0)}
              placeholder="Enter seed for reproducible results"
            />
             <p className="text-xs text-muted-foreground">
               Using the same seed will generate the same variants
             </p>
          </div>
        </CardContent>
      </Card>

       {/* Generate button */}
       <div className="flex justify-center">
         <Button size="lg" onClick={handleGenerate} disabled={isGenerating}>
           {isGenerating ? (
             <>
               <Clock className="size-4 mr-2 animate-spin" />
               Generating...
               <Progress value={generationProgress} className="ml-4 w-20" />
             </>
           ) : (
             <>
               {cs.common.generate} Variants
             </>
           )}
         </Button>
       </div>

       {/* Preview */}
       {previewVariants.length > 0 && (
         <Card>
           <CardHeader>
             <CardTitle>Variant Preview</CardTitle>
             <CardDescription>Preview of the first variant from each template</CardDescription>
           </CardHeader>
           <CardContent>
             <div className="space-y-4">
               <div className="flex gap-2 mb-4">
                 {previewVariants.map((variant, index) => (
                   <div
                     key={variant.id}
                     className={selectedPreviewIndex === index ? "opacity-100" : "opacity-50"}
                   >
                     <Button
                       size="sm"
                       variant={selectedPreviewIndex === index ? "default" : "outline"}
                       onClick={() => setSelectedPreviewIndex(index)}
                     >
                       Variant <span className="font-mono tabular">{index + 1}</span>
                     </Button>
                   </div>
                 ))}
               </div>

              {selectedPreviewIndex < previewVariants.length && (
                <div className="p-4 bg-muted rounded-lg">
                  <div className="flex items-start gap-4">
                    <div className="flex-1">
                      <h4 className="font-semibold mb-2">Correct Answers</h4>
                      {(() => {
                        const variant = previewVariants[selectedPreviewIndex]
                        if (variant.answersData && variant.answersData.length > 0) {
                          return (
                            <div className="space-y-1 mb-4">
                              {variant.answersData.map((a) => (
                         <p key={a.symbol} className="text-muted-foreground">
                                   {a.symbol} = <span className="font-mono tabular">{formatNumberMaxDecimals(a.value)}</span>
                                   {a.unit ? ` ${a.unit}` : ""}
                                 </p>
                              ))}
                            </div>
                          )
                        }
                         return (
                           <p className="text-muted-foreground mb-4">
                             <span className="font-mono tabular">{formatNumberMaxDecimals(variant.correctAnswer)}</span>
                           </p>
                         )
                      })()}
                       <div className="grid grid-cols-2 gap-4">
                         <div>
                           <Label>Primary Answer</Label>
                           <Badge variant="default" className="mt-2 font-mono tabular">
                             {formatNumberMaxDecimals(
                               previewVariants[selectedPreviewIndex].correctAnswer,
                             )}
                           </Badge>
                         </div>
                         <div>
                           <Label>Seed</Label>
                           <Badge variant="secondary" className="mt-2 font-mono tabular">
                             {previewVariants[selectedPreviewIndex].seed}
                           </Badge>
                         </div>
                       </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Export section */}
      {generatedVariants.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Export Settings</CardTitle>
            <CardDescription>Configure the export filename</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="filename">Filename</Label>
              <Input
                id="filename"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                placeholder="e.g., biochemcalc_assignment"
              />
               <p className="text-xs text-muted-foreground">Will be saved as .txt file</p>
            </div>

            <div className="flex gap-4">
              <Button
                variant="outline"
                onClick={() => setFilename(`biochemcalc_${new Date().toISOString().slice(0, 10)}`)}
              >
                Use Today's Date
              </Button>
              <Button onClick={handleExport}>
                <Download className="size-4 mr-2" />
                {cs.common.export}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-4 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          {cs.common.back}
        </Button>
        {generatedVariants.length > 0 && <Button onClick={handleExport}>{cs.common.next}</Button>}
      </div>
    </div>
  )
}


