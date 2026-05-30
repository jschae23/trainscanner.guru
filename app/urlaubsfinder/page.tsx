import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isFooterEnabled, isUrlaubsfinderEnabled } from "@/lib/shared/feature-flags"
import UrlauberfinderClientPage from "./urlaubsfinder-client"

export const metadata: Metadata = {
  title: "Urlaubsfinder",
  description:
    "Finde günstige Bahnreiseziele für deinen Urlaub. Mit dem Urlaubsfinder entdeckst du die besten Sparpreise der Deutschen Bahn für deine Traumreise.",
}

export const dynamic = "force-dynamic"

export default function UrlauberfinderPage() {
  if (!isUrlaubsfinderEnabled()) {
    notFound()
  }

  return <UrlauberfinderClientPage showFooter={isFooterEnabled()} />
}
