// What `pnpm mobile:contract` writes into mobile/contract/ for the Android and
// iPhone apps (docs/features/mobile-apps.md, phase C1): the API schema from
// @paddlesnitch/api/contract and the design tokens from @paddlesnitch/ui's
// tokens.css. Pure, so the contract test can compare it with what's committed.
import { apiContractFiles } from '@paddlesnitch/api/contract'

export type DesignTokens = {
  color: Record<string, string>
  radius: Record<string, number>
  font: Record<string, string>
}

/** The colours, radii and font families from tokens.css, for the apps' themes. */
export function tokensFromCss(css: string): DesignTokens {
  const tokens: DesignTokens = { color: {}, radius: {}, font: {} }
  for (const [, group, name, value] of css.matchAll(/--(color|radius|font)-([a-z0-9-]+):\s*([^;]+);/g)) {
    if (group === 'color') tokens.color[name] = value.trim()
    // Only plain pixel radii; the apps scale them themselves.
    else if (group === 'radius') tokens.radius[name] = parseFloat(value)
    // The first quoted family: the web's next/font variable means nothing to an app.
    else tokens.font[name] = /"([^"]+)"/.exec(value)?.[1] ?? value.trim()
  }
  return tokens
}

/** Every file under mobile/contract/ that is generated, path → content. */
export function mobileContractFiles(tokensCss: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const [name, content] of Object.entries(apiContractFiles())) files[`api/${name}`] = content
  files['tokens/tokens.json'] = JSON.stringify(tokensFromCss(tokensCss), null, 2) + '\n'
  return files
}
