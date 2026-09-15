import { cs } from "@/i18n/cs"

/**
 * The credit/contact footer shown at the bottom of every student page
 * (practice, test, leaderboard, settings), extracted from the practice
 * page so the shell can render it once for all of them.
 */
export function StudentFooter() {
  return (
    <footer className="mt-10 pt-6 border-t border-border text-center text-[13px] text-muted-foreground space-y-1">
      <p>
        {cs.student.footerTeacher}:{" "}
        <strong className="text-foreground">Mgr. Vojtěch Sedláček, Ph.D.</strong>
        {" · "}
        <a href="mailto:21931@mail.muni.cz" className="text-primary hover:underline">
          21931@mail.muni.cz
        </a>
      </p>
      <p>
        {cs.student.footerAuthor} <strong className="text-foreground">Mgr. Vojtěch Rejtar</strong>
        {" · "}
        {cs.student.footerContact}:{" "}
        <a href="mailto:rejtarv@gmail.com" className="text-primary hover:underline">
          rejtarv@gmail.com
        </a>
        {" | "}
        <a href="mailto:rejtarv@sci.muni.cz" className="text-primary hover:underline">
          rejtarv@sci.muni.cz
        </a>
      </p>
      <p>{cs.student.footerBugs}</p>
      <p>
        <a
          href="https://github.com/KowalskiBio/biochemcalc/blob/main/LICENSE"
          className="text-primary hover:underline"
        >
          {cs.student.footerLicense}
        </a>
      </p>
    </footer>
  )
}
