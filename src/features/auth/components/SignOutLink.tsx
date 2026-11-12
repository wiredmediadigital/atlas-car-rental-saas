import { useState } from 'react'

import { Button } from '@/components/ui'
import { useAuth } from '@/features/auth/auth-context'

/**
 * The way out of the three second-factor screens.
 *
 * Those are the only pages an unenrolled user can reach, and AuthLayout carries
 * no navigation of its own. Somebody who cannot finish — signed in as the wrong
 * account, on a project where the authenticator was never switched on, or
 * meeting a failure that keeps repeating — would otherwise be held there:
 * `/sign-in` sends a signed-in user to the application, the second-factor guard
 * sends them back, and clearing site data is the only escape left. One link is
 * the whole fix.
 *
 * Signing out is enough on its own. The guard is keyed on the session, so the
 * sign-in screen becomes reachable the moment there is no session.
 */
export function SignOutLink() {
  const { signOut } = useAuth()
  const [isSigningOut, setIsSigningOut] = useState(false)

  const leave = async () => {
    setIsSigningOut(true)
    try {
      await signOut()
    } catch {
      // There is nothing useful to say: the button comes back, and pressing it
      // tries again. Leaving it spinning would be the real failure.
    } finally {
      setIsSigningOut(false)
    }
  }

  return (
    <Button variant="link" size="sm" isLoading={isSigningOut} onClick={() => void leave()}>
      Sign out and use a different account
    </Button>
  )
}
