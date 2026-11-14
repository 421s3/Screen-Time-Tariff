import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { ScreenTimeTariff } from "../target/types/screen_time_tariff";

describe("screen_time_tariff (winner-takes-pool)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.screenTimeTariff as Program<ScreenTimeTariff>;
  const conn = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const STAKE = 0.1 * LAMPORTS_PER_SOL;
  const TARIFF = 0.01 * LAMPORTS_PER_SOL;
  // Seconds until period_end. Override for fast local runs: PERIOD_SECS=8 anchor test ...
  const PERIOD = Number(process.env.PERIOD_SECS ?? 30);

  const oracle = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const carol = Keypair.generate();

  const gid = new BN(Date.now());
  const pdaGroup = (id: BN) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("group"), admin.publicKey.toBuffer(), id.toArrayLike(Buffer, "le", 8)],
      program.programId
    )[0];
  const pdaVault = (g: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("vault"), g.toBuffer()], program.programId)[0];
  const pdaMember = (g: PublicKey, w: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("member"), g.toBuffer(), w.toBuffer()],
      program.programId
    )[0];
  const rem = (pk: PublicKey) => ({ pubkey: pk, isWritable: true, isSigner: false });
  const sortKeys = (ks: PublicKey[]) =>
    [...ks].sort((a, b) => Buffer.compare(a.toBuffer(), b.toBuffer()));

  async function fund(kp: Keypair, sol: number) {
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: kp.publicKey,
          lamports: Math.round(sol * LAMPORTS_PER_SOL),
        })
      )
    );
  }
  const fails = async (p: Promise<any>, msg: string) => {
    try { await p; } catch (e: any) { assert.include(String(e), msg); return; }
    assert.fail(`expected failure containing "${msg}"`);
  };
  const bal = async (m: PublicKey) => (await program.account.member.fetch(m)).balance.toNumber();

  async function setup(id: BN, wallets: Keypair[], graceSecs = PERIOD * 4) {
    const group = pdaGroup(id);
    const vault = pdaVault(group);
    const periodEnd = new BN(Math.floor(Date.now() / 1000) + PERIOD);
    await program.methods
      .createGroup(id, oracle.publicKey, 1, new BN(TARIFF), periodEnd, new BN(graceSecs))
      .accountsPartial({ admin: admin.publicKey, group, vault })
      .rpc();
    for (const w of wallets) {
      await program.methods
        .joinAndStake(new BN(STAKE))
        .accountsPartial({ wallet: w.publicKey, group, vault, member: pdaMember(group, w.publicKey) })
        .signers([w])
        .rpc();
    }
    return { group, vault };
  }
  const slash = (group: PublicKey, w: Keypair, minutes: number, signer = oracle) =>
    program.methods
      .slash(minutes)
      .accountsPartial({ oracle: signer.publicKey, group, member: pdaMember(group, w.publicKey) })
      .signers([signer])
      .rpc();
  const settle = (group: PublicKey, winners: PublicKey[], signer = oracle) =>
    program.methods
      .settle()
      .accountsPartial({ oracle: signer.publicKey, group })
      .remainingAccounts(winners.map((k) => rem(k)))
      .signers([signer])
      .rpc();
  const withdraw = (group: PublicKey, vault: PublicKey, w: Keypair) =>
    program.methods
      .withdraw()
      .accountsPartial({ wallet: w.publicKey, group, vault, member: pdaMember(group, w.publicKey) })
      .signers([w])
      .rpc();

  const refund = (group: PublicKey, vault: PublicKey, w: Keypair) =>
    program.methods
      .emergencyRefund()
      .accountsPartial({ wallet: w.publicKey, group, vault, member: pdaMember(group, w.publicKey) })
      .signers([w])
      .rpc();
  const sleep = (secs: number) => new Promise((r) => setTimeout(r, secs * 1000));

  before(async () => {
    await fund(oracle, 0.05);
    for (const k of [alice, bob, carol]) await fund(k, 0.5); // 3 groups x 0.1 stake + rent
  });

  describe("group A: single winner", () => {
    let group: PublicKey, vault: PublicKey;
    const [mA, mB, mC] = [alice, bob, carol].map((k) => (g: PublicKey) => pdaMember(g, k.publicKey));

    it("creates group and accepts stakes into the vault", async () => {
      ({ group, vault } = await setup(gid, [alice, bob, carol]));
      const g = await program.account.group.fetch(group);
      assert.equal(g.memberCount, 3);
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal(await conn.getBalance(vault), 3 * STAKE + rentMin);
    });

    it("rejects create_group with grace_secs = 0 (no settle window)", async () => {
      await fails(setup(gid.add(new BN(9)), [], 0), "InvalidRules");
    });

    it("rejects slash by a non-oracle", async () => {
      await fails(slash(group, alice, 5, alice), "Unauthorized");
    });

    it("slashes keep funds in the vault and grow the pool", async () => {
      const before = await conn.getBalance(vault);
      await slash(group, alice, 3);
      await slash(group, carol, 1);
      assert.equal(await conn.getBalance(vault), before);
      const g = await program.account.group.fetch(group);
      assert.equal(g.penaltyPool.toNumber(), 4 * TARIFF);
      assert.equal(await bal(mA(group)), STAKE - 3 * TARIFF);
    });

    it("is idempotent on replay and caps at remaining stake", async () => {
      await slash(group, alice, 3); // replay: no change
      assert.equal(await bal(mA(group)), STAKE - 3 * TARIFF);
      await slash(group, carol, 1000); // way over: capped
      assert.equal(await bal(mC(group)), 0);
      const g = await program.account.group.fetch(group);
      assert.equal(g.penaltyPool.toNumber(), 3 * TARIFF + STAKE); // alice 3 + carol's whole stake
    });

    it("blocks settle/withdraw before the period ends and settle by non-oracle", async () => {
      await fails(settle(group, [bob.publicKey].map((k) => mB(group))), "PeriodNotOver");
      await fails(withdraw(group, vault, bob), "NotSettled");
    });

    it("settles: rejects bad winner sets, then pays bob the whole pool", async () => {
      await new Promise((r) => setTimeout(r, (PERIOD + 3) * 1000));
      await fails(settle(group, [mB(group)], alice), "Unauthorized");
      await fails(settle(group, []), "BadWinners");
      const dup = sortKeys([mB(group)]); // duplicate / unsorted checks
      await fails(settle(group, [dup[0], dup[0]]), "BadWinners");
      const pool = (await program.account.group.fetch(group)).penaltyPool.toNumber();
      await settle(group, [mB(group)]);
      assert.equal(await bal(mB(group)), STAKE + pool);
      await fails(settle(group, [mB(group)]), "AlreadySettled");
      await fails(slash(group, alice, 99), "AlreadySettled");
    });

    it("everyone withdraws; vault ends at its rent minimum; no double withdraw", async () => {
      for (const w of [alice, bob, carol]) await withdraw(group, vault, w);
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal(await conn.getBalance(vault), rentMin);
      await fails(withdraw(group, vault, bob), "AlreadyWithdrawn");
    });
  });

  describe("group B: tie splits deterministically", () => {
    let group: PublicKey, vault: PublicKey;

    it("3-way tie on a pool that doesn't divide evenly: remainder to the lowest pubkey", async () => {
      const id = gid.add(new BN(1));
      ({ group, vault } = await setup(id, [alice, bob, carol]));
      await slash(group, carol, 1); // pool = TARIFF = 10,000,000 -> 3,333,333 each + 1 remainder
      await new Promise((r) => setTimeout(r, (PERIOD + 3) * 1000));
      const all = sortKeys([alice, bob, carol].map((k) => pdaMember(group, k.publicKey)));
      const pool = (await program.account.group.fetch(group)).penaltyPool.toNumber();
      const share = Math.floor(pool / 3);
      const remainder = pool - share * 3;
      assert.equal(remainder, 1);
      await fails(settle(group, [all[1], all[0], all[2]]), "BadWinners"); // unsorted
      await settle(group, all);
      const carolM = pdaMember(group, carol.publicKey);
      for (const m of all) {
        const base = m.equals(carolM) ? STAKE - TARIFF : STAKE;
        const expected = base + share + (m.equals(all[0]) ? remainder : 0);
        assert.equal(await bal(m), expected);
      }
      // invariant: member balances + vault rent == vault lamports
      let total = 0;
      for (const m of all) total += await bal(m);
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal(total + rentMin, await conn.getBalance(vault));
    });

    it("emergency_refund after settle fails", async () => {
      await fails(refund(group, vault, alice), "AlreadySettled");
    });
  });

  describe("group C: emergency_refund when the oracle never settles", () => {
    const GRACE = PERIOD * 2;
    let group: PublicKey, vault: PublicKey;

    it("refund fails before period_end and before period_end + grace", async () => {
      ({ group, vault } = await setup(gid.add(new BN(2)), [alice, bob, carol], GRACE));
      await slash(group, alice, 3); // alice's balance drops; her deposit does not
      await fails(refund(group, vault, alice), "GraceNotOver");
      await sleep(PERIOD + 3); // period over, grace still running
      await fails(refund(group, vault, alice), "GraceNotOver");
    });

    it("after the grace period, unsettled: refunds the ORIGINAL deposit; no double refund", async () => {
      await sleep(GRACE);
      const mA = pdaMember(group, alice.publicKey);
      const deposited = (await program.account.member.fetch(mA)).deposited.toNumber();
      assert.equal(deposited, STAKE);
      const before = await conn.getBalance(alice.publicKey);
      await refund(group, vault, alice); // fee is paid by the provider wallet
      assert.equal((await conn.getBalance(alice.publicKey)) - before, deposited);
      const m = await program.account.member.fetch(mA);
      assert.isTrue(m.withdrawn);
      assert.equal(m.balance.toNumber(), 0);
      await fails(refund(group, vault, alice), "AlreadyWithdrawn");
      await fails(withdraw(group, vault, bob), "NotSettled");
    });

    it("oracle cannot settle once refunds are open (would double-pay slashed lamports)", async () => {
      const winners = sortKeys([bob, carol].map((k) => pdaMember(group, k.publicKey)));
      await fails(settle(group, winners), "GraceOver");
    });

    it("everyone else refunds; vault ends at its rent minimum", async () => {
      for (const w of [bob, carol]) await refund(group, vault, w);
      const rentMin = await conn.getMinimumBalanceForRentExemption(0);
      assert.equal(await conn.getBalance(vault), rentMin);
    });
  });
});
