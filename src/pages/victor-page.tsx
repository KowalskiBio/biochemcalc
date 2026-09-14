import { Bot, Loader2, Send, User } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { UnitRenderer } from "@/components/ui/unit-renderer"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { victorApi } from "@/lib/api"
import type { VictorMessage, VictorRequest, VictorResponse } from "@/lib/types"
import { formatDecimalComma } from "@/lib/utils"

export function VictorPage() {
  const { toast } = useToast()
  const [messages, setMessages] = useState<VictorMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: VictorMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    }

    // Optimistic update - add user message immediately
    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setError(null)
    setIsLoading(true)

    const request: VictorRequest = {
      question: userMessage.content,
      history: [...messages, userMessage],
    }

    try {
      const response: VictorResponse = await victorApi.chat(request)

      const assistantMessage: VictorMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: JSON.stringify({
          calculation: response.calculation,
          solution: response.solution,
          explanation: response.explanation,
          variables: response.variables,
        }),
        timestamp: new Date().toISOString(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : cs.victor.error
      setError(errorMessage)
      toast({
        title: cs.victor.error,
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const parseAssistantMessage = (content: string): VictorResponse | null => {
    try {
      return JSON.parse(content) as VictorResponse
    } catch {
      return null
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{cs.victor.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">{cs.victor.description}</p>
      </div>

      <div className="flex-1 flex flex-col gap-4">
        {/* Chat messages */}
        <div className="flex-1 flex flex-col gap-4 overflow-y-auto max-h-[60vh] min-h-[40vh] border rounded-lg p-4 bg-muted/50">
          {messages.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-center">
              <Bot className="size-12 mb-4 opacity-50" />
              <p>{cs.victor.inputPlaceholder}</p>
            </div>
          ) : (
            messages.map((message) => {
              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex gap-3 max-w-[80%] self-end">
                    <div className="flex-1 bg-primary text-primary-foreground rounded-lg px-4 py-2">
                      <p className="text-sm">{message.content}</p>
                    </div>
                    <User className="size-8 text-primary shrink-0 mt-auto" />
                  </div>
                )
              }

              // Assistant message
              const responseData = parseAssistantMessage(message.content)
              return (
                <div key={message.id} className="flex gap-3 max-w-[90%]">
                  <Bot className="size-8 text-muted-foreground shrink-0 mt-auto" />
                  <div className="flex-1 space-y-2">
                    {responseData ? (
                      <>
                        {/* Structured response card */}
                        <Card className="bg-card border-border">
                          <CardHeader className="pb-3">
                            <CardTitle className="text-lg">{cs.victor.solution}</CardTitle>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {/* Calculation */}
                            {responseData.calculation && (
                              <div>
                                <h3 className="font-medium text-sm mb-1">
                                  {cs.victor.calculation}:
                                </h3>
                                <p className="text-sm bg-muted p-2 rounded">
                                  {responseData.calculation}
                                </p>
                              </div>
                            )}

                            {/* Solution */}
                            {responseData.solution && (
                              <div>
                                <h3 className="font-medium text-sm mb-1">{cs.victor.solution}:</h3>
                                <p className="text-sm">{responseData.solution}</p>
                              </div>
                            )}

                            {/* Explanation */}
                            {responseData.explanation && (
                              <div>
                                <h3 className="font-medium text-sm mb-1">
                                  {cs.victor.explanation}:
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                  {responseData.explanation}
                                </p>
                              </div>
                            )}

                            {/* Variables as badges */}
                            {responseData.variables && responseData.variables.length > 0 && (
                              <div>
                                <h3 className="font-medium text-sm mb-1">{cs.victor.variables}:</h3>
                                <div className="flex flex-wrap gap-2">
                                  {responseData.variables.map((variable) => (
                                    <Badge
                                      key={variable.symbol}
                                      variant="secondary"
                                      className="font-mono tabular"
                                    >
                                      {variable.symbol} ={" "}
                                      {formatDecimalComma(String(variable.value))}{" "}
                                      <UnitRenderer unit={variable.unit} />
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      </>
                    ) : (
                      // Fallback for plain text
                      <div className="bg-muted p-3 rounded-lg">
                        <p className="text-sm">{message.content}</p>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}

          {/* Loading state */}
          {isLoading && (
            <div className="flex gap-3 max-w-[80%]">
              <Bot className="size-8 text-muted-foreground shrink-0" />
              <div className="bg-muted p-3 rounded-lg">
                <p className="text-sm flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" />
                  {cs.victor.thinking}
                </p>
              </div>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="flex gap-3 max-w-[80%]">
              <Bot className="size-8 text-destructive shrink-0" />
              <div className="bg-destructive/10 text-destructive p-3 rounded-lg">
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={cs.victor.inputPlaceholder}
            disabled={isLoading}
            className="flex-1 min-h-[80px] resize-none"
            rows={1}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="icon"
            className="size-12 shrink-0"
          >
            {isLoading ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
