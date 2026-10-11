import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}

// False on the server and during hydration, true after it — so a component can
// render a placeholder in the server HTML and the browser-only thing (a Leaflet
// map) once hydrated, without setState in an effect.
export function useIsClient() {
  return useSyncExternalStore(subscribe, () => true, () => false)
}
