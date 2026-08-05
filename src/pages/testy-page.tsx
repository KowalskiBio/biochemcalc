import { Download, Eye, FileText, Loader2, Trash2 } from "lucide-react"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, generationApi } from "@/lib/api"
import type { OutputFile, OutputFileContent } from "@/lib/types"

export function TestyPage() {
  const { toast } = useToast()
  const [files, setFiles] = useState<OutputFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [viewing, setViewing] = useState<OutputFileContent | null>(null)
  const [isLoadingContent, setIsLoadingContent] = useState(false)

  const fetchFiles = useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await generationApi.listOutputFiles()
      setFiles(data)
    } catch (err) {
      const message = err instanceof ApiError ? err.message : String(err)
      toast({
        title: "Chyba",
        description: message,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void fetchFiles()
  }, [fetchFiles])

  const handleView = useCallback(
    async (file: OutputFile) => {
      try {
        setIsLoadingContent(true)
        const content = await generationApi.readOutputFile(file.id)
        setViewing(content)
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsLoadingContent(false)
      }
    },
    [toast],
  )

  const handleDownload = useCallback(
    async (file: OutputFile) => {
      try {
        const { content } = await generationApi.readOutputFile(file.id)
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = file.filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba",
          description: message,
          variant: "destructive",
        })
      }
    },
    [toast],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        setIsDeleting(id)
        await generationApi.deleteOutputFile(id)
        toast({
          title: "Test smazán",
          description: "Soubor byl úspěšně odstraněn.",
        })
        await fetchFiles()
      } catch (err) {
        const message = err instanceof ApiError ? err.message : String(err)
        toast({
          title: "Chyba",
          description: message,
          variant: "destructive",
        })
      } finally {
        setIsDeleting(null)
      }
    },
    [fetchFiles, toast],
  )

  const formatDate = (value: string) => {
    try {
      return new Date(value).toLocaleString("cs-CZ")
    } catch {
      return value
    }
  }

  return (
    <div
      className="space-y-6"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cs.testy.title}</h1>
        <p className="text-muted-foreground text-sm">{cs.testy.description}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="size-5" />
            {cs.testy.listTitle}
          </CardTitle>
          <CardDescription>{cs.testy.listDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>{cs.testy.emptyState.title}</p>
              <p className="text-sm">{cs.testy.emptyState.description}</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{cs.testy.columns.filename}</TableHead>
                  <TableHead>{cs.testy.columns.createdAt}</TableHead>
                  <TableHead className="text-right">{cs.testy.columns.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="font-medium">{file.filename}</TableCell>
                    <TableCell>{formatDate(file.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleView(file)}
                          disabled={isLoadingContent}
                        >
                          <Eye className="size-4 mr-1" />
                          {cs.common.preview}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void handleDownload(file)}>
                          <Download className="size-4 mr-1" />
                          {cs.common.download}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDelete(file.id)}
                          disabled={isDeleting === file.id}
                        >
                          {isDeleting === file.id ? (
                            <Loader2 className="size-4 mr-1 animate-spin" />
                          ) : (
                            <Trash2 className="size-4 mr-1" />
                          )}
                          {cs.common.delete}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewing !== null} onOpenChange={() => setViewing(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{viewing?.file.filename}</DialogTitle>
          </DialogHeader>
          <pre className="flex-1 overflow-auto bg-muted p-4 rounded-md text-sm whitespace-pre-wrap">
            {viewing?.content}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  )
}
