// The Nitalink mark on a transparent background.
// theme="auto" swaps in the light-ring version in dark mode, so the navy ring never disappears on a dark surface.
// Use theme="light" where the background is always light (e.g. the login page).
export default function BrandLogo({ size, theme = 'auto', className = '', style, alt = 'Nitalink' }) {
  const s = { ...(size ? { width: size, height: size } : {}), ...style }
  if (theme === 'light') return <img src="/logo-mark.svg" alt={alt} className={`brand-logo ${className}`} style={s} />
  return (
    <>
      <img src="/logo-mark.svg" alt={alt} className={`brand-logo brand-logo-light ${className}`} style={s} />
      <img src="/logo-mark-dark.svg" alt="" aria-hidden="true" className={`brand-logo brand-logo-dark ${className}`} style={s} />
    </>
  )
}
