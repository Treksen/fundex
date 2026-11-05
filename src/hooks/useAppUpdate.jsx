/* global __APP_VERSION__, __APP_BUILD_TIME__ */
import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { createUpdateController } from '../lib/updateController'

// Injected at build time by vite.config.js (package.json version + build timestamp)
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const APP_BUILD_TIME = typeof __APP_BUILD_TIME__ !== 'undefined' ? __APP_BUILD_TIME__ : null

export const isStandaloneApp = () =>
  (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
  (typeof navigator !== 'undefined' && navigator.standalone === true)

const UpdateContext = createContext(null)

export function UpdateProvider({ children }) {
  // Service workers only run in the production build
  const supported =
    import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator

  const controllerRef = useRef(null)
  if (!controllerRef.current) {
    controllerRef.current = createUpdateController({
      serviceWorker: supported ? navigator.serviceWorker : null,
      location: window.location,
      documentRef: document,
      storage: window.sessionStorage,
      caches: window.caches,
    })
  }
  const controller = controllerRef.current

  useEffect(() => controller.start(), [controller])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)

  const value = useMemo(
    () => ({
      ...state,
      version: APP_VERSION,
      buildTime: APP_BUILD_TIME,
      supported,
      dismiss: controller.dismiss,
      checkForUpdate: controller.checkForUpdate,
      applyUpdate: controller.applyUpdate,
      resetAppCache: controller.resetAppCache,
    }),
    [state, supported, controller]
  )

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}

export const useAppUpdate = () => {
  const ctx = useContext(UpdateContext)
  if (!ctx) throw new Error('useAppUpdate must be used within UpdateProvider')
  return ctx
}
