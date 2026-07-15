import { motion } from "framer-motion"
import { Settings } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { victorApi } from "@/lib/api"

const DEFAULT_API_BASE_URL = "https://api.moonshot.cn/v1/chat/completions"

export function SettingsPage() {
  const { toast } = useToast()
  const [settings, setSettings] = useState({
    apiBaseUrl: "",
    apiKey: "",
  })
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const loadedSettings = await victorApi.getSettings()
        setSettings({
          apiBaseUrl: loadedSettings.apiBaseUrl || "",
          apiKey: loadedSettings.apiKey || "",
        })
      } catch (_error) {
        toast({
          title: cs.settings.victor.error,
          variant: "destructive",
        })
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [toast])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await victorApi.setSettings({
        apiBaseUrl: settings.apiBaseUrl.trim() || DEFAULT_API_BASE_URL,
        apiKey: settings.apiKey.trim(),
      })
      toast({
        title: cs.settings.victor.saved,
        variant: "default",
      })
    } catch (_error) {
      toast({
        title: cs.settings.victor.error,
        variant: "destructive",
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setSettings({
      apiBaseUrl: DEFAULT_API_BASE_URL,
      apiKey: "",
    })
  }

  if (isLoading) {
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
          <h1 className="text-2xl font-bold text-foreground">{cs.settings.title}</h1>
          <p className="text-foreground-secondary mt-1">{cs.settings.description}</p>
        </motion.div>
        <p className="text-foreground-muted">{cs.common.loading}...</p>
      </motion.div>
    )
  }

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
        <h1 className="text-2xl font-bold text-foreground">{cs.settings.title}</h1>
        <p className="text-foreground-secondary mt-1">{cs.settings.description}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="size-5" />
              {cs.settings.victor.title}
            </CardTitle>
            <CardDescription>{cs.settings.victor.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiBaseUrl">{cs.settings.victor.apiBaseUrlLabel}</Label>
              <Input
                id="apiBaseUrl"
                type="text"
                value={settings.apiBaseUrl}
                onChange={(e) => setSettings((prev) => ({ ...prev, apiBaseUrl: e.target.value }))}
                placeholder={cs.settings.victor.apiBaseUrlPlaceholder}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiKey">{cs.settings.victor.apiKeyLabel}</Label>
              <Input
                id="apiKey"
                type="password"
                value={settings.apiKey}
                onChange={(e) => setSettings((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={cs.settings.victor.apiKeyPlaceholder}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? cs.settings.victor.saving : cs.settings.victor.save}
              </Button>
              <Button variant="outline" onClick={handleReset} disabled={isSaving}>
                {cs.common.cancel}
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  )
}
