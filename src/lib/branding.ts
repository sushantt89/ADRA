import type { DocketBranding } from '../db/types'

/** The ADRA logo that ships with the app (public/adra-logo.png). */
export const ADRA_LOGO = `${import.meta.env.BASE_URL}adra-logo.png`

/** 'builtin' = the ADRA logo, '' = no logo, otherwise an uploaded image (data URL). */
export function logoSrc(b: DocketBranding): string {
  return b.logo === 'builtin' ? ADRA_LOGO : b.logo
}
