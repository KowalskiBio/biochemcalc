import { Check, Copy, FileText } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
// Import shadcn/ui components
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
// Import hooks
import { useToast } from "@/hooks/use-toast"
// Czech translations
import { cs } from "@/i18n/cs"
// Import API
import { generationApi } from "@/lib/api"
import type { ExportInput, ExportResult } from "@/lib/types"

interface ExportPreviewProps {
  exportInput: ExportInput
  onBack: () => void
  onComplete: () => void
}

export function ExportPreview({ exportInput, onBack, onComplete }: ExportPreviewProps) {
  const { toast } = useToast()
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [_isExporting, setIsExporting] = useState(false)
  const [copied, setCopied] = useState(false)

  // Export to text file
  const handleExport = useCallback(async () => {
    try {
      setIsExporting(true)
      const result = await generationApi.exportToTxt(exportInput)
      setExportResult(result)

      toast({
        title: cs.toasts.success.exported.replace("{type}", "Assignment"),
        description: `Exported to ${result.filePath}`,
      })
    } catch (err) {
      toast({
        title: "Export Failed",
        description: err instanceof Error ? err.message : "Failed to export file",
        variant: "destructive",
      })
    } finally {
      setIsExporting(false)
    }
  }, [exportInput, toast])

  // Copy content to clipboard
  const handleCopy = useCallback(async () => {
    if (!exportResult?.content) return

    try {
      await navigator.clipboard.writeText(exportResult.content)
      setCopied(true)
      toast({
        title: "Copied to Clipboard",
        description: "Assignment content copied successfully",
      })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({
        title: "Copy Failed",
        description: "Could not copy to clipboard",
        variant: "destructive",
      })
    }
  }, [exportResult, toast])

  // Auto-trigger export when component mounts
  useEffect(() => {
    if (exportInput && !exportResult) {
      handleExport()
    }
  }, [exportInput, exportResult, handleExport])

   if (!exportResult) {
     return (
       <div className="flex items-center justify-center py-12">
         <div className="text-center space-y-4">
           <div className="inline-block p-4 bg-muted rounded-full">
             <FileText className="size-8 text-muted-foreground" />
           </div>
           <p className="text-muted-foreground">Exporting your assignment...</p>
         </div>
       </div>
     )
   }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold tracking-tight text-foreground">Export Preview</h3>
        <p className="text-sm text-muted-foreground">
          Review your generated assignment and export the file
        </p>
      </div>

      {/* Export summary */}
      <Card>
        <CardHeader>
          <CardTitle>Export Summary</CardTitle>
          <CardDescription>Your assignment has been generated successfully</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
           <div className="grid grid-cols-2 gap-4">
             <div>
               <Label>Filename</Label>
               <Badge variant="default" className="mt-2 block font-mono tabular">
                 {exportResult.filePath.split("/").pop() || exportInput.filename}
               </Badge>
             </div>
             <div>
               <Label>File Path</Label>
               <Badge variant="secondary" className="mt-2 block truncate font-mono">
                 {exportResult.filePath}
               </Badge>
             </div>
           </div>

           <div className="space-y-2">
             <Label>Character Count</Label>
             <Badge variant="outline" className="font-mono tabular">{exportResult.content.length} characters</Badge>
           </div>
        </CardContent>
      </Card>

      {/* Content preview */}
      <Card>
        <CardHeader>
          <CardTitle>Content Preview</CardTitle>
          <CardDescription>First 50 lines of the exported file</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-4 rounded-lg">
            <Textarea
              value={exportResult.content.split("\n").slice(0, 50).join("\n")}
              className="w-full min-h-[300px] bg-transparent border-none p-0 resize-none font-mono text-sm"
              readOnly
            />
            {exportResult.content.split("\n").length > 50 && (
              <p className="text-xs text-foreground-muted mt-2">
                ... and {exportResult.content.split("\n").length - 50} more lines
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-4">
          <Button variant="outline" onClick={handleCopy} disabled={copied}>
            <Copy className="size-4 mr-2" />
            {copied ? "Copied!" : "Copy to Clipboard"}
          </Button>
          <Button onClick={onComplete}>
            <Check className="size-4 mr-2" />
            Complete
          </Button>
        </CardContent>
      </Card>

      <div className="flex gap-4 justify-between pt-4">
        <Button variant="outline" onClick={onBack}>
          {cs.common.back}
        </Button>
        <Button onClick={onComplete}>Finish</Button>
      </div>
    </div>
  )
}
