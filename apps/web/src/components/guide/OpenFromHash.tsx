'use client'
import { useEffect } from 'react'

// Opens the <details> a link points at (/guide/troubleshooting#wifi), so a
// link from a guide step lands on the answer, not on a closed question.
export default function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      const el = id ? document.getElementById(id) : null
      if (el instanceof HTMLDetailsElement && !el.open) {
        el.open = true
        el.scrollIntoView()
      }
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [])
  return null
}
