import { Loader2, Swords } from "lucide-react"
import { useCallback, useState } from "react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { cs } from "@/i18n/cs"
import { extractErrorMessage } from "@/lib/http"
import { studentApi } from "@/lib/student-api"
import type { StartStreakRunInput } from "@/lib/types"

/**
 * Where a student launches a Mistr streak run. Mistr has nothing to
 * configure — it always draws from every topic — so this is a description
 * and a start button. (Učeň is configured right in its block on the Test
 * page.)
 */
export function StudentStreakSetupPage() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const [isStarting, setIsStarting] = useState(false)

  const handleStart = useCallback(async () => {
    setIsStarting(true)
    try {
      const input: StartStreakRunInput = { kind: "master" }
      const run = await studentApi.startStreakRun(input)
      // `input` travels alongside the run so the results page can offer an
      // instant "Znovu" that repeats this exact configuration.
      navigate("/test/streak/active", { state: { run, input } })
    } catch (error) {
      toast({
        title: extractErrorMessage(error, cs.streak.setupStartError),
        variant: "destructive",
      })
    } finally {
      setIsStarting(false)
    }
  }, [navigate, toast])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {cs.test.modeMistrTitle}
        </h1>
        <p className="text-muted-foreground text-sm">{cs.test.modeMistrDescription}</p>
      </div>

      <Card className="max-w-lg">
        <CardContent className="pt-6">
          <Button onClick={handleStart} disabled={isStarting} size="lg">
            {isStarting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Swords className="size-4 mr-2" />
            )}
            {isStarting ? cs.streak.setupStarting : cs.streak.setupStartButton}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
