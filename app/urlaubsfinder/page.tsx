import { notFound } from "next/navigation"
import { isFooterEnabled, isUrlaubsfinderEnabled } from "@/lib/shared/feature-flags"
import UrlauberfinderClientPage from "./urlaubsfinder-client"

export const dynamic = "force-dynamic"

export default function UrlauberfinderPage() {
  if (!isUrlaubsfinderEnabled()) {
    notFound()
  }

  return <UrlauberfinderClientPage showFooter={isFooterEnabled()} />
}
