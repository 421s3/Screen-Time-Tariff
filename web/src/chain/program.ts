// Phantom-signed transactions for Xayden's Anchor program (CP3, CHAIN_MODE=devnet).
// Seeds follow docs/contract.md section 6 and backend/src/chain/pda.ts.
// The IDL in ./idl is a copy of program/idl/ (re-copy it if the program changes).
import { AnchorProvider, BN, Program, type Wallet } from '@coral-xyz/anchor'
import { Connection, PublicKey } from '@solana/web3.js'
import idlJson from './idl/screen_time_tariff.json'
import type { ScreenTimeTariff } from './idl/screen_time_tariff'

/** emergency_refund opens at period_end + grace. Same value the backend uses (config.graceSecs). */
export const GRACE_SECS = 600

/** What the wallet adapter's useAnchorWallet() returns. */
export type ChainSigner = {
  connection: Connection
  wallet: Pick<Wallet, 'publicKey' | 'signTransaction' | 'signAllTransactions'>
}

function u64Le(value: string): Uint8Array {
  const buf = new Uint8Array(8)
  new DataView(buf.buffer).setBigUint64(0, BigInt(value), true)
  return buf
}

export function groupPdaFor(programId: PublicKey, admin: PublicKey, groupSeed: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('group'), admin.toBuffer(), u64Le(groupSeed)],
    programId,
  )[0]
}

export function memberPdaFor(programId: PublicKey, groupPda: PublicKey, wallet: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('member'), groupPda.toBuffer(), wallet.toBuffer()],
    programId,
  )[0]
}

function program(signer: ChainSigner, programId: string): Program<ScreenTimeTariff> {
  const provider = new AnchorProvider(signer.connection, signer.wallet as Wallet, {
    commitment: 'confirmed',
  })
  // The IDL's address must match the program the backend uses.
  const idl = { ...(idlJson as ScreenTimeTariff), address: programId }
  return new Program<ScreenTimeTariff>(idl, provider)
}

export async function createGroupOnChain(
  signer: ChainSigner,
  programId: string,
  args: {
    oracle: string
    allowanceMinutes: number
    tariffLamportsPerMinute: number
    periodEndMs: number
  },
): Promise<{ signature: string; groupPda: string; groupSeed: string }> {
  const pid = new PublicKey(programId)
  const admin = signer.wallet.publicKey
  const groupSeed = String(Date.now())
  const groupPda = groupPdaFor(pid, admin, groupSeed)
  const signature = await program(signer, programId)
    .methods.createGroup(
      new BN(groupSeed),
      new PublicKey(args.oracle),
      args.allowanceMinutes,
      new BN(args.tariffLamportsPerMinute),
      new BN(Math.floor(args.periodEndMs / 1000)),
      new BN(GRACE_SECS),
    )
    .accountsPartial({ admin, group: groupPda })
    .rpc()
  return { signature, groupPda: groupPda.toBase58(), groupSeed }
}

/** Has this wallet already got a Member account? (The program only allows one stake per wallet.) */
export async function hasStakedOnChain(
  signer: ChainSigner,
  programId: string,
  groupPda: string,
): Promise<boolean> {
  const member = memberPdaFor(new PublicKey(programId), new PublicKey(groupPda), signer.wallet.publicKey)
  return (await signer.connection.getAccountInfo(member)) !== null
}

export async function joinAndStakeOnChain(
  signer: ChainSigner,
  programId: string,
  groupPda: string,
  lamports: number,
): Promise<string> {
  const pid = new PublicKey(programId)
  const group = new PublicKey(groupPda)
  const wallet = signer.wallet.publicKey
  return program(signer, programId)
    .methods.joinAndStake(new BN(lamports))
    .accountsPartial({ wallet, group, member: memberPdaFor(pid, group, wallet) })
    .rpc()
}

export async function withdrawOnChain(
  signer: ChainSigner,
  programId: string,
  groupPda: string,
): Promise<string> {
  const pid = new PublicKey(programId)
  const group = new PublicKey(groupPda)
  const wallet = signer.wallet.publicKey
  return program(signer, programId)
    .methods.withdraw()
    .accountsPartial({ wallet, group, member: memberPdaFor(pid, group, wallet) })
    .rpc()
}
