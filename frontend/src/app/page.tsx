'use client'

import { useState } from 'react'
import BiometricLogin from '@/components/BiometricLogin'
import InboxDashboard from '@/components/InboxDashboard'

export default function Home() {
  const [authenticated, setAuthenticated] = useState(false)

  return (
    <main>
      {!authenticated ? (
        <BiometricLogin onSuccess={() => setAuthenticated(true)} />
      ) : (
        <InboxDashboard onSignOut={() => setAuthenticated(false)} />
      )}
    </main>
  )
}
