import type { Metadata } from "next"
import DirektverbindungenClient from "@/components/direktverbindungen/direktverbindungen-client"
import { isFooterEnabled } from "@/lib/shared/feature-flags"

export const metadata: Metadata = {
  title: "Direktverbindungen",
  description:
    "Entdecke alle Direktverbindungen der Deutschen Bahn – von ICE bis Regionalverkehr. Finde Strecken ohne Umstiege und plane deine Bahnreise.",
}

export const dynamic = "force-dynamic"

export default function DirektverbindungenPage() {
  return <DirektverbindungenClient showFooter={isFooterEnabled()} />
}
