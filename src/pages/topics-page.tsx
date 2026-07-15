import { motion } from "framer-motion"
import { BookOpen, Plus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { ApiError, topicsApi } from "@/lib/api"
import type { Topic } from "@/lib/types"

export function TopicsPage() {
  const { toast } = useToast()
  const [topics, setTopics] = useState<Topic[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const fetchTopics = useCallback(async () => {
    try {
      setIsLoading(true)
      const data = await topicsApi.list()
      setTopics(data)
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
    fetchTopics()
  }, [fetchTopics])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="space-y-6"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{cs.topics.pageTitle}</h1>
            <p className="text-foreground-secondary mt-1">{cs.topics.pageDescription}</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/bulk-import">
              <Plus className="size-4 mr-2" />
              {cs.topics.addMore}
            </Link>
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-center">
              <p className="text-foreground-muted">Načítám témata...</p>
            </CardContent>
          </Card>
        ) : topics.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <BookOpen className="size-12 text-foreground-muted mx-auto mb-4" />
              <p className="text-foreground-secondary">{cs.topics.noTopics}</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topics.map((topic) => (
              <motion.div key={topic.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Link to={`/topics/${topic.id}`}>
                  <Card className="h-full cursor-pointer hover:border-primary transition-colors">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <BookOpen className="size-5 text-primary" />
                        {topic.name}
                      </CardTitle>
                      <CardDescription>
                        {new Date(topic.createdAt).toLocaleDateString("cs-CZ")}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
