"use client"

import Link from "next/link"

export function BrandLogo() {
  return (
    <Link
      href="/"
      className="group inline-flex items-baseline rounded-lg text-gray-900 transition-colors hover:text-blue-700 dark:text-gray-100 dark:hover:text-blue-400"
      aria-label="trainscanner.site Startseite"
    >
      <span className="text-3xl font-bold leading-none tracking-normal text-gray-900 sm:text-4xl dark:text-gray-100">
        trainscanner<span className="font-semibold text-blue-600 dark:text-blue-400">.site</span>
      </span>
    </Link>
  )
}
