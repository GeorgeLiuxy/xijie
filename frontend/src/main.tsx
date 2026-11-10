import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './mobile/legacy-theme.css'
import { isNativeRuntime } from './mobile/back'

if (isNativeRuntime()) document.documentElement.classList.add('native-app')

const GiftGoalEntry = React.lazy(() => import('./gifts/GiftGoals').then(module => ({ default: module.GiftGoalEntry })))
const InviteEntry = React.lazy(() => import('./gifts/InviteFriends').then(module => ({ default: module.InviteEntry })))
const RelayEntry = React.lazy(() => import('./relay/RelayStation').then(module => ({ default: module.RelayEntry })))
const InteractionPreview = React.lazy(() => import('./design/InteractionPreview'))
const pathname = location.pathname.replace(/\/$/, '')
const isGiftInvitation = /\/gifts\/[^/]+$/.test(pathname)
const isNewUserInvitation = /\/invite\/[^/]+$/.test(pathname)
const isRelay = /\/relay(?:\/[^/]+)?$/.test(pathname)
const isInteractionPreview = pathname === '/design-interaction'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center text-ink-soft">正在打开西界…</div>}>
      {isInteractionPreview ? <InteractionPreview /> : isGiftInvitation ? <GiftGoalEntry /> : isNewUserInvitation ? <InviteEntry /> : isRelay ? <RelayEntry /> : <App />}
    </React.Suspense>
  </React.StrictMode>,
)
