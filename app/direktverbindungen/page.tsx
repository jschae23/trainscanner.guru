import DirektverbindungenClient from "@/components/direktverbindungen/direktverbindungen-client"
import { isFooterEnabled } from "@/lib/shared/feature-flags"

export const dynamic = "force-dynamic"

export default function DirektverbindungenPage() {
  return <DirektverbindungenClient showFooter={isFooterEnabled()} />
}
