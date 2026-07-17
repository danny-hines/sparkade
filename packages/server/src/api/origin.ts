/** True when a browser Origin is the HTTP origin represented by the request's
 * Host header. This lets the kiosk work at a DHCP address or .local name while
 * still rejecting a different LAN page trying to drive its mutation API. */
export function isSameHttpOrigin(origin: string | undefined, host: string | undefined): boolean {
  return !!origin && !!host && origin === `http://${host}`;
}
