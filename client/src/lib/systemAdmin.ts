/**
 * Protected System Console queries must not run before the administrator
 * session is established. This avoids expected 403s becoming console errors
 * on the intentionally locked Dashboard and Settings routes.
 */
export function shouldEnableAdminQuery(authorized: boolean | undefined): boolean {
  return authorized === true;
}
