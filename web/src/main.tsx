import { StrictMode, useMemo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { Toaster } from 'sonner'
import '@solana/wallet-adapter-react-ui/styles.css'
import './index.css'
import App from './App'
import { RPC_URL } from './config'

const queryClient = new QueryClient()

function SolanaProviders({ children }: { children: ReactNode }) {
  // Phantom only, devnet only.
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SolanaProviders>
        <BrowserRouter>
          <App />
          <Toaster theme="dark" position="top-right" richColors />
        </BrowserRouter>
      </SolanaProviders>
    </QueryClientProvider>
  </StrictMode>,
)
