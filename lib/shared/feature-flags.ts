export function isUrlaubsfinderEnabled(): boolean {
  return process.env.ENABLE_URLAUBSFINDER?.toLowerCase() !== "false"
}

export function isFooterEnabled(): boolean {
  const value = process.env.SHOW_FOOTER?.toLowerCase()
  return value === "true" || value === "1" || value === "yes"
}
