/** `server-only` is a bundler alias Next.js provides; plain node cannot resolve
 *  it. The demo scripts run outside Next but only ever import server modules,
 *  so the guard has nothing to protect and an empty module is the whole stub. */
export {};
