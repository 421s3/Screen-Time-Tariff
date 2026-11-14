import { useEffect } from 'react'
import { useAnchorWallet, useConnection } from '@solana/wallet-adapter-react'
import type { ChainSigner } from './program'

// realApi isn't a React component, so the connected Phantom wallet is handed to it here.
let current: ChainSigner | null = null

export function getChainSigner(): ChainSigner | null {
  return current
}

/** Mount once inside the wallet providers. Renders nothing. */
export function ChainSignerBridge() {
  const { connection } = useConnection()
  const wallet = useAnchorWallet()
  useEffect(() => {
    current = wallet ? { connection, wallet } : null
  }, [connection, wallet])
  return null
}
