import { Link, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { House } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from './components/kit'
import { Landing } from './pages/Landing'
import { CreateGroup } from './pages/CreateGroup'
import { JoinGroup } from './pages/JoinGroup'
import { Stake } from './pages/Stake'
import { PairTracker } from './pages/PairTracker'
import { Dashboard } from './pages/Dashboard'
import { Results } from './pages/Results'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="create" element={<CreateGroup />} />
        <Route path="join" element={<JoinGroup />} />
        <Route path="group/:groupId" element={<Dashboard />} />
        <Route path="group/:groupId/stake" element={<Stake />} />
        <Route path="group/:groupId/pair" element={<PairTracker />} />
        <Route path="group/:groupId/results" element={<Results />} />
        <Route
          path="*"
          element={
            <EmptyState title="Page not found" body="That page doesn't exist.">
              <Button asChild variant="outline">
                <Link to="/">
                  <House /> Back home
                </Link>
              </Button>
            </EmptyState>
          }
        />
      </Route>
    </Routes>
  )
}
