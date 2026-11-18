// Security, App & Updates and Admin used to be tabs inside Settings. For admins they now live in the Admin part of the
// sidebar (above Audit Log). Members keep Profile, Notifications, Security and App & Updates inside Settings.

export const ADMIN_SECTION_PATHS = { security: '/security', updates: '/updates', admin: '/admin' }

export const SECTION_TITLES = {
  security: ['Security', 'Password and sign-in'],
  updates: ['App & Updates', 'Check your version and update the app'],
  admin: ['Admin Panel', 'Manage members and group settings'],
}

// Where to send the user, or null to stay put. `profileLoaded` stops a page refresh from treating a not-yet-loaded
// admin as a member and bouncing them away.
export function settingsRedirect({ section, requestedTab, isAdmin, profileLoaded }) {
  if (!profileLoaded) return null
  if (!section) return isAdmin && ADMIN_SECTION_PATHS[requestedTab] ? ADMIN_SECTION_PATHS[requestedTab] : null // old /settings?tab=... links
  if (section === 'admin' && !isAdmin) return '/settings'
  return null
}
