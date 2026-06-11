"use client"

import Link from "next/link"

export function BrandLogo() {
  return (
    <Link
      href="/"
      className="group inline-flex items-baseline rounded-lg text-gray-900 transition-colors hover:text-blue-700"
      aria-label="trainscanner.site Startseite"
    >
      <span className="text-3xl font-bold leading-none tracking-normal text-gray-900 sm:text-4xl">
        trainscanner<span className="font-semibold text-blue-600">.site</span>
      </span>
    </Link>
  )
}
