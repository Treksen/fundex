// One place for the password rule used by "Forgot password". Same minimum as the rest of the app (8).
export const MIN_PASSWORD = 8
export const MAX_PASSWORD = 72 // the hashing algorithm only uses the first 72 bytes

export function validateNewPassword(password, confirm) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters`
  if (password.length > MAX_PASSWORD) return `Password must be at most ${MAX_PASSWORD} characters`
  if (confirm !== undefined && password !== confirm) return 'The two passwords do not match'
  return null
}
