// The OpenAPI 3.1 description of /api/v1 (#511), served at
// /api/v1/openapi.json and rendered on /api. Keep it in step with the routes
// under src/app/api/v1 (api-v1.test.ts checks every path has a handler).
const str = { type: 'string' } as const
const num = { type: 'number' } as const
const int = { type: 'integer' } as const
const bool = { type: 'boolean' } as const
const nullable = (s: object) => ({ oneOf: [s, { type: 'null' }] })
const point = { type: 'object', required: ['lat', 'lng'], properties: { lat: num, lng: num } }
const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
})

export function openApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'paddlesnitch API',
      version: '1',
      description: 'Read-only, public data from paddlesnitch: river and canal plans across the UK, Ireland and much of western Europe, and public time trials. '
        + 'No key needed. Units are in field names (distance_km, duration_s); times are ISO 8601 with an offset; GeoJSON coordinates are [lng, lat], everything else is {lat, lng}. '
        + 'Every response names its sources in `attribution`: show those credits wherever you show the data. '
        + 'For planning only: paddlesnitch is not a navigation authority.',
    },
    servers: [{ url: origin }],
    paths: {
      '/api/v1/plan': {
        get: {
          summary: 'Plan a paddle',
          description: 'A route between two points on the water, with every lock, weir, portage, access point and facility along it, timed at your pace. The same parameters as a /plan link.',
          parameters: [
            { name: 'from', in: 'query', required: true, schema: str, description: '"lat,lng", or a place name such as "Cropredy Lock".', example: '52.0607,-1.3341' },
            { name: 'to', in: 'query', required: true, schema: str, description: '"lat,lng", or a place name.', example: '52.1155,-1.3218' },
            { name: 'waterway', in: 'query', schema: str, description: 'Keep named ends to this waterway, e.g. "oxford-canal".' },
            { name: 'shape', in: 'query', schema: { type: 'string', enum: ['one_way', 'return'], default: 'one_way' }, description: 'return: out to `to` and back to `from`.' },
            { name: 'pace', in: 'query', schema: { type: 'number', minimum: 1, maximum: 30, default: 8 }, description: 'Moving pace, km/h.' },
            { name: 'portage', in: 'query', schema: { type: 'number', minimum: 0, maximum: 120, default: 3 }, description: 'Minutes added at each portage.' },
            { name: 'at', in: 'query', schema: { type: 'string', format: 'date-time' }, description: 'Start time; with it every stop gets an `eta`.' },
          ],
          responses: {
            200: { description: 'The plan', content: { 'application/json': { schema: { $ref: '#/components/schemas/PlanResponse' } } } },
            400: errorResponse('A parameter is missing or out of range (code bad_request).'),
            404: errorResponse('A named end was not found on the water (code not_found).'),
            422: errorResponse('No route: start_off_water, finish_off_water, too_short or not_connected.'),
          },
        },
      },
      '/api/v1/places': {
        get: {
          summary: 'Find places on the water',
          description: 'Locks, wharves, slipways, portages and towns by name, each with its waterway: for choosing a plan\'s ends.',
          parameters: [
            { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2, maxLength: 100 }, example: 'Cropredy' },
            { name: 'near', in: 'query', schema: str, description: '"lat,lng": nearer matches first among equals.' },
            { name: 'waterway', in: 'query', schema: str, description: 'Only places on this waterway.' },
          ],
          responses: {
            200: { description: 'Matches, best first', content: { 'application/json': { schema: { type: 'object', properties: { api_version: str, places: { type: 'array', items: { $ref: '#/components/schemas/Place' } }, attribution: { type: 'array', items: { $ref: '#/components/schemas/Attribution' } } } } } } },
            400: errorResponse('q is missing or too long.'),
          },
        },
      },
      '/api/v1/trials': {
        get: {
          summary: 'Public time trials',
          parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'closed'] } }],
          responses: { 200: { description: 'Newest first', content: { 'application/json': { schema: { type: 'object', properties: { api_version: str, trials: { type: 'array', items: { $ref: '#/components/schemas/Trial' } } } } } } } },
        },
      },
      '/api/v1/trials/{trialId}': {
        get: {
          summary: 'One public time trial',
          parameters: [{ name: 'trialId', in: 'path', required: true, schema: str }],
          responses: {
            200: { description: 'The trial and its course', content: { 'application/json': { schema: { type: 'object', properties: { api_version: str, trial: { $ref: '#/components/schemas/Trial' } } } } } },
            404: errorResponse('No such public trial.'),
          },
        },
      },
      '/api/v1/trials/{trialId}/leaderboard': {
        get: {
          summary: 'A public trial\'s results',
          parameters: [
            { name: 'trialId', in: 'path', required: true, schema: str },
            { name: 'boat_class', in: 'query', schema: str, description: 'e.g. K1, 1X, 8+' },
          ],
          responses: {
            200: { description: 'Fastest first', content: { 'application/json': { schema: { type: 'object', properties: { api_version: str, trial_id: str, results: { type: 'array', items: { $ref: '#/components/schemas/Result' } } } } } } },
            404: errorResponse('No such public trial.'),
          },
        },
      },
    },
    components: {
      schemas: {
        Error: { type: 'object', required: ['error'], properties: { api_version: str, error: { type: 'object', required: ['code', 'message'], properties: { code: str, message: str } } } },
        Attribution: { type: 'object', properties: { source: str, name: str, licence: str, attribution: str, url: str } },
        Place: { type: 'object', properties: { name: str, kind: str, waterway: nullable(str), lat: num, lng: num } },
        Stop: {
          type: 'object',
          properties: {
            id: { ...str, description: 'Stable within a plan; the same id the /plan page uses.' },
            feature_id: str, kind: { type: 'string', description: 'lock, weir, portage, access, slipway, facility, hazard, …' },
            name: nullable(str), leg: { type: 'string', enum: ['out', 'back'] },
            km: num, from_previous_km: num, elapsed_s: int, eta: nullable({ type: 'string', format: 'date-time' }),
            bank: nullable({ type: 'string', enum: ['left', 'right'], description: 'Looking in the direction of travel.' }),
            portage: { ...bool, description: 'You get out of the boat here.' },
            beside_the_route: { ...bool, description: 'A weir beside a canal (a bywash): nothing to portage.' },
            lat: num, lng: num, source: str, source_url: nullable(str),
            landings: { type: 'array', items: { type: 'object', properties: { take_out: point, put_in: point, carry_m: int, rollers: nullable(bool), notes: nullable(str), source: { type: 'string', enum: ['openportage', 'osm'] } } } },
          },
        },
        PlanResponse: {
          type: 'object',
          properties: {
            api_version: str,
            plan: {
              type: 'object',
              properties: {
                shape: str, pace_kmh: num, portage_minutes: num,
                start: point, finish: point,
                distance_km: num, turn_km: nullable(num), moving_s: int, duration_s: int, portages: int,
                start_at: nullable(str), finish_at: nullable(str),
                waterways: { type: 'array', items: str }, canoe_routes: { type: 'array', items: str },
                reaches_tidal_water_km: nullable(num),
                route: { type: 'object', description: 'GeoJSON Feature with a LineString ([lng, lat]).' },
                stops: { type: 'array', items: { $ref: '#/components/schemas/Stop' } },
              },
            },
            links: { type: 'object', properties: { page: { ...str, description: 'The same plan on paddlesnitch.com.' } } },
            attribution: { type: 'array', items: { $ref: '#/components/schemas/Attribution' } },
            notice: str,
          },
        },
        Trial: {
          type: 'object',
          properties: {
            id: str, name: str, date: str, status: { type: 'string', enum: ['open', 'closed'] },
            participation: { type: 'string', enum: ['public', 'members', 'invitational'] },
            course: nullable({ type: 'object', properties: { id: str, name: str, type: str, sport: str, distance_km: num, start_line: { type: 'array', items: point }, finish_line: nullable({ type: 'array', items: point }), gates: nullable({ type: 'array' }) } }),
            links: { type: 'object', properties: { page: str, leaderboard: str } },
          },
        },
        Result: {
          type: 'object',
          properties: {
            rank: int, display_name: str, boat_class: str, elapsed_s: num, race_date: str, submitted_at: str,
            avg_stroke_rate_spm: nullable(num),
            splits: { type: 'array', items: { type: 'object', properties: { distance_m: int, elapsed_s: num } } },
          },
        },
      },
    },
  }
}
